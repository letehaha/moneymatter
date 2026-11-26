import {
  NOTIFICATION_TYPES,
  UNREALIZED_LOSS_ALERT_DEFAULTS,
  type UnrealizedLossAlertNotificationPayload,
  getNotificationChannels,
} from '@bt/shared/types';
import { getConversionDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { connection } from '@models/connection';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import type { SettingsSchema } from '@models/user-settings.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { appName, appUrl, buildAlertEmail, fromEmail } from '@services/email';
import { sendEmail } from '@services/email/send-email';
import * as notificationsService from '@services/notifications';
import { getEmailForUser } from '@services/sharing/find-user-by-email.service';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { QueryTypes } from 'sequelize';

import { getHoldingValues } from './get-holding-values.service';

type AlertConfig = NonNullable<SettingsSchema['unrealizedLossAlerts']>;
type AlertedHolding = UnrealizedLossAlertNotificationPayload['holdings'][number];

/** The `lossAlertedAt: null` guard makes each claim atomic, so a concurrent run can't notify twice. */
const latchAndNotify = withTransaction(
  async ({
    userId,
    currencyCode,
    percentThreshold,
    amountThreshold,
    candidates,
  }: {
    userId: number;
    currencyCode: string;
    percentThreshold: number;
    amountThreshold: number;
    candidates: AlertedHolding[];
  }): Promise<AlertedHolding[]> => {
    const now = new Date();
    const claimed: AlertedHolding[] = [];
    for (const holding of candidates) {
      const [count] = await Holdings.update(
        { lossAlertedAt: now },
        { where: { portfolioId: holding.portfolioId, securityId: holding.securityId, lossAlertedAt: null } },
      );
      if (count) claimed.push(holding);
    }
    if (!claimed.length) return claimed;

    await notificationsService.createNotification({
      userId,
      type: NOTIFICATION_TYPES.unrealizedLossAlert,
      title: t({ key: 'investments.unrealizedLossAlert.title', variables: { count: claimed.length } }),
      payload: {
        currencyCode,
        percentThreshold,
        amountThreshold,
        holdings: claimed,
      } satisfies UnrealizedLossAlertNotificationPayload,
      push: true,
    });
    return claimed;
  },
);

/** Best-effort: the alert has already fired in-app, so a failed send is only logged. */
const sendLossEmail = async ({ userId, holdings }: { userId: number; holdings: AlertedHolding[] }) => {
  try {
    const { locale, notifications } = await getUserSettings({ userId });
    if (!getNotificationChannels({ category: 'unrealizedLoss', preferences: notifications }).email) return;
    const to = await getEmailForUser({ userId });
    if (!to) {
      logger.warn('[UnrealizedLossAlertEmail] User has no email address', {
        code: 'UNREALIZED_LOSS_ALERT_EMAIL_NO_ADDRESS',
        userId,
      });
      return;
    }

    const subject = t({ key: 'investments.unrealizedLossAlert.title', variables: { count: holdings.length }, locale });
    const portfolioIds = new Set(holdings.map((holding) => holding.portfolioId));
    const result = await sendEmail({
      from: `${appName} <${fromEmail}>`,
      to,
      subject,
      html: buildAlertEmail({
        title: subject,
        items: holdings.map(({ symbol, lossPercent, portfolioName }) => ({
          heading: symbol,
          text: `−${lossPercent}%`,
          caption: portfolioName,
        })),
        link: portfolioIds.size === 1 ? `${appUrl}/portfolios/${holdings[0]!.portfolioId}` : `${appUrl}/investments`,
        cta: t({ key: 'investments.unrealizedLossAlert.emailCta', locale }),
        footer: t({ key: 'investments.unrealizedLossAlert.emailFooter', locale }),
      }),
    });
    if (result?.error) throw new Error(`${result.error.name}: ${result.error.message}`);
  } catch (error) {
    logger.error(
      { message: 'Unrealized loss alert email failed', error: error as Error },
      { code: 'UNREALIZED_LOSS_ALERT_EMAIL_FAILED', userId },
    );
  }
};

const checkUser = async ({ userId, config }: { userId: number; config: AlertConfig }): Promise<number> => {
  const percentThreshold = config.percentThreshold ?? UNREALIZED_LOSS_ALERT_DEFAULTS.percentThreshold;
  const amountThreshold = config.amountThreshold ?? UNREALIZED_LOSS_ALERT_DEFAULTS.amountThreshold;
  const portfolios = await Portfolios.findAll({ where: { userId }, attributes: ['id', 'name'] });
  const baseCurrency = await UsersCurrencies.getBaseCurrency({ userId });
  if (!baseCurrency) throw new Error(`User ${userId} has no base currency`);
  const baseCurrencyCode = baseCurrency.currency.code;

  const candidates: AlertedHolding[] = [];
  const recovered: Holdings[] = [];

  for (const portfolio of portfolios) {
    const [values, holdings] = await Promise.all([
      getHoldingValues({ portfolioId: portfolio.id, userId }),
      Holdings.findAll({
        where: { portfolioId: portfolio.id },
        attributes: ['portfolioId', 'securityId', 'lossAlertedAt'],
      }),
    ]);
    const holdingsById = new Map<string, Holdings>(holdings.map((h) => [h.securityId, h]));

    for (const value of values) {
      const holding = holdingsById.get(value.securityId);
      if (!holding) continue;
      const quantity = Number(value.quantity);
      // A fully sold holding re-arms, so a rebuy that drops alerts again.
      if (quantity === 0 && holding.lossAlertedAt) recovered.push(holding);
      // Without a price the market value reads 0, which would look like a 100% loss.
      if (value.latestPrice === undefined || quantity <= 0 || value.excluded) continue;

      const gain = Money.fromDecimal(value.unrealizedGainValue ?? 0);
      const lossPercent = -Number(value.unrealizedGainPercent ?? 0);
      const lossAmount =
        value.baseRate !== undefined
          ? calculateRefAmountFromParams({
              amount: gain,
              rate: value.baseRate,
              ...(await getConversionDecimals({
                userId,
                definitionOwnerUserId: userId,
                baseCode: value.currencyCode,
                quoteCode: baseCurrencyCode,
              })),
            })
              .negate()
              .toNumber()
          : null;
      // Both thresholds are at least 1, so crossing implies a loss.
      const crosses = lossPercent >= percentThreshold || (lossAmount !== null && lossAmount >= amountThreshold);

      if (crosses && !holding.lossAlertedAt) {
        candidates.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          securityId: holding.securityId,
          symbol: value.security?.symbol ?? value.security?.name ?? '',
          assetClass: value.security?.assetClass,
          logoUrl: value.security?.logoUrl ?? null,
          lossPercent: Number(lossPercent.toFixed(2)),
          lossAmount,
        });
      } else if (!crosses && holding.lossAlertedAt && (!gain.isNegative() || lossAmount !== null)) {
        // ponytail: no hysteresis, a loss hovering at the threshold can re-alert every other day; add a recovery margin if users complain.
        recovered.push(holding);
      }
    }
  }

  // Matching the read `lossAlertedAt` keeps a concurrent run's fresh latch from being wiped.
  for (const { portfolioId, securityId, lossAlertedAt } of recovered) {
    await Holdings.update({ lossAlertedAt: null }, { where: { portfolioId, securityId, lossAlertedAt } });
  }

  if (!candidates.length) return 0;
  const claimed = await latchAndNotify({
    userId,
    currencyCode: baseCurrencyCode,
    percentThreshold,
    amountThreshold,
    candidates,
  });
  if (claimed.length) await sendLossEmail({ userId, holdings: claimed });
  return claimed.length;
};

export const checkUnrealizedLossAlerts = async () => {
  const rows = (await connection.sequelize.query(
    `SELECT "userId", "settings"->'unrealizedLossAlerts' AS "config" FROM "UserSettings"
     WHERE "settings"->'unrealizedLossAlerts'->>'enabled' = 'true'`,
    { type: QueryTypes.SELECT },
  )) as { userId: number; config: AlertConfig }[];
  const result = { usersChecked: rows.length, notified: 0, failed: 0, errors: [] as string[] };

  for (const { userId, config } of rows) {
    try {
      result.notified += (await checkUser({ userId, config })) ? 1 : 0;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      logger.error(
        { message: `Unrealized loss alert check failed for user ${userId}`, error: error as Error },
        { code: 'UNREALIZED_LOSS_ALERT_USER_FAILED' },
      );
    }
  }

  if (result.failed > 0) {
    logger.error(`Unrealized loss alert check finished with ${result.failed} failures`, {
      code: 'UNREALIZED_LOSS_ALERT_CHECK_PARTIAL_FAILURE',
      usersChecked: result.usersChecked,
      notified: result.notified,
    });
  }

  return result;
};
