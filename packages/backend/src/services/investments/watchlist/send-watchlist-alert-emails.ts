import { FEATURES, type WatchlistAlertNotificationPayload } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { connection } from '@models/connection';
import Portfolios from '@models/investments/portfolios.model';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import WatchlistItems from '@models/investments/watchlist-items.model';
import { appName, appUrl, buildAlertEmail, fromEmail } from '@services/email';
import { sendEmail } from '@services/email/send-email';
import { hasFeature } from '@services/entitlements/feature-trial.service';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';
import { getEmailForUser } from '@services/sharing/find-user-by-email.service';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { Op, QueryTypes } from 'sequelize';

import { describeAlert } from './check-watchlist-alerts';

type PendingAlert = WatchlistAlerts & { item: WatchlistItems & { portfolio: Portfolios } };

const buildDigest = ({ payloads, locale }: { payloads: WatchlistAlertNotificationPayload[]; locale: string }) => {
  const alerts = payloads.map((payload) => ({ payload, ...describeAlert({ payload, locale }) }));
  const subject =
    alerts.length === 1
      ? alerts[0]!.title
      : t({ key: 'investments.watchlistAlert.digestSubject', variables: { count: alerts.length }, locale });
  const portfolioIds = new Set(payloads.map((payload) => payload.portfolioId));

  return {
    subject,
    html: buildAlertEmail({
      title: subject,
      items: alerts.map(({ payload, title, message }) => ({
        heading: title,
        text: message,
        caption: payload.portfolioName,
      })),
      link:
        portfolioIds.size === 1
          ? `${appUrl}/portfolios/${payloads[0]!.portfolioId}?tab=watchlist`
          : `${appUrl}/investments`,
      cta: t({ key: 'investments.watchlistAlert.emailCta', locale }),
      footer: t({ key: 'investments.watchlistAlert.emailFooter', locale }),
    }),
  };
};

/** Best-effort: the alerts have already fired, so a failed send is logged and counted, never retried. */
const sendUserDigest = async ({
  userId,
  alerts,
}: {
  userId: number;
  alerts: PendingAlert[];
}): Promise<'sent' | 'skipped' | 'failed'> => {
  const claimed = (await connection.sequelize.query(
    `UPDATE "WatchlistAlerts" alert SET "pendingEmailPayload" = NULL
     FROM (
       SELECT "id", "pendingEmailPayload" FROM "WatchlistAlerts"
       WHERE "id" IN (:ids) AND "pendingEmailPayload" IS NOT NULL
       FOR UPDATE
     ) old
     WHERE alert."id" = old."id"
     RETURNING old."pendingEmailPayload" AS "payload"`,
    { type: QueryTypes.SELECT, replacements: { ids: alerts.map((alert) => alert.id) } },
  )) as { payload: WatchlistAlertNotificationPayload }[];
  const payloads = claimed.map((row) => row.payload);
  if (!payloads.length) return 'skipped';
  if (!hasFeature({ entitlements: await getEntitlementsByUserId({ userId }), feature: FEATURES.watchlist })) {
    logger.info('[WatchlistAlertEmail] Dropped the alerts of a user without the watchlist feature', {
      code: 'WATCHLIST_ALERT_EMAIL_NOT_ENTITLED',
      userId,
      dropped: payloads.length,
    });
    return 'skipped';
  }

  const to = await getEmailForUser({ userId });
  if (!to) {
    logger.warn('[WatchlistAlertEmail] User has no email address', {
      code: 'WATCHLIST_ALERT_EMAIL_NO_ADDRESS',
      userId,
    });
    return 'failed';
  }
  const { locale } = await getUserSettings({ userId });
  const result = await sendEmail({ from: `${appName} <${fromEmail}>`, to, ...buildDigest({ payloads, locale }) });
  if (!result) return 'skipped';
  if (result.error) throw new Error(`${result.error.name}: ${result.error.message}`);
  return 'sent';
};

/**
 * Sends each user one email with every alert that fired since the last run, so the cron interval
 * caps how often a user is emailed. A run claims the alerts before sending, so concurrent runs never
 * send the same alert twice.
 */
export const sendWatchlistAlertEmails = async () => {
  const pending = (await WatchlistAlerts.findAll({
    where: { pendingEmailPayload: { [Op.ne]: null } },
    include: [
      {
        model: WatchlistItems,
        required: true,
        attributes: ['id'],
        include: [{ model: Portfolios, required: true, attributes: ['id', 'userId'] }],
      },
    ],
  })) as PendingAlert[];
  const result = { sent: 0, skipped: 0, failed: 0 };

  for (const [userId, alerts] of Map.groupBy(pending, (alert) => alert.item.portfolio.userId)) {
    try {
      result[await sendUserDigest({ userId, alerts })] += 1;
    } catch (error) {
      result.failed += 1;
      logger.error(
        { message: '[WatchlistAlertEmail] Failed to send', error: error as Error },
        { code: 'WATCHLIST_ALERT_EMAIL_FAILED', userId },
      );
    }
  }
  return result;
};
