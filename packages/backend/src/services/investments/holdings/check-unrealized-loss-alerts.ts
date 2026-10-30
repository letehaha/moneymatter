import {
  NOTIFICATION_TYPES,
  UNREALIZED_LOSS_ALERT_DEFAULTS,
  type UnrealizedLossAlertNotificationPayload,
} from '@bt/shared/types';
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
import * as notificationsService from '@services/notifications';
import { QueryTypes } from 'sequelize';

import { getHoldingValues } from './get-holding-values.service';

type AlertConfig = NonNullable<SettingsSchema['unrealizedLossAlerts']>;
type AlertedHolding = UnrealizedLossAlertNotificationPayload['holdings'][number];

/** The `lossAlertedAt: null` guard makes each claim atomic, so a concurrent run can't notify twice. */
const latchAndNotify = withTransaction(
  async ({
    userId,
    currencyCode,
    candidates,
  }: {
    userId: number;
    currencyCode: string;
    candidates: AlertedHolding[];
  }): Promise<number> => {
    const now = new Date();
    const claimed: AlertedHolding[] = [];
    for (const holding of candidates) {
      const [count] = await Holdings.update(
        { lossAlertedAt: now },
        { where: { portfolioId: holding.portfolioId, securityId: holding.securityId, lossAlertedAt: null } },
      );
      if (count) claimed.push(holding);
    }
    if (!claimed.length) return 0;

    await notificationsService.createNotification({
      userId,
      type: NOTIFICATION_TYPES.unrealizedLossAlert,
      title: t({ key: 'investments.unrealizedLossAlert.title', variables: { count: claimed.length } }),
      payload: { currencyCode, holdings: claimed } satisfies UnrealizedLossAlertNotificationPayload,
    });
    return claimed.length;
  },
);

const checkUser = async ({ userId, config }: { userId: number; config: AlertConfig }): Promise<number> => {
  const percentThreshold = config.percentThreshold ?? UNREALIZED_LOSS_ALERT_DEFAULTS.percentThreshold;
  const amountThreshold = config.amountThreshold ?? UNREALIZED_LOSS_ALERT_DEFAULTS.amountThreshold;
  const portfolios = await Portfolios.findAll({ where: { userId }, attributes: ['id', 'name'] });

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
          ? calculateRefAmountFromParams({ amount: gain, rate: value.baseRate }).negate().toNumber()
          : null;
      // Both thresholds are at least 1, so crossing implies a loss.
      const crosses = lossPercent >= percentThreshold || (lossAmount !== null && lossAmount >= amountThreshold);

      if (crosses && !holding.lossAlertedAt) {
        candidates.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          securityId: holding.securityId,
          symbol: value.security?.symbol ?? value.security?.name ?? '',
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
  const baseCurrency = await UsersCurrencies.getBaseCurrency({ userId });
  if (!baseCurrency) throw new Error(`User ${userId} has no base currency`);
  return latchAndNotify({ userId, currencyCode: baseCurrency.currency.code, candidates });
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
