import { FEATURES, type WatchlistAlertNotificationPayload } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { connection } from '@models/connection';
import Portfolios from '@models/investments/portfolios.model';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import WatchlistItems from '@models/investments/watchlist-items.model';
import { appName, appUrl, buildEmailShell, escapeHtml, fromEmail } from '@services/email';
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
  const link = escapeHtml(
    portfolioIds.size === 1
      ? `${appUrl}/portfolios/${payloads[0]!.portfolioId}?tab=watchlist`
      : `${appUrl}/investments`,
  );
  const rows = alerts
    .map(
      ({ payload, title, message }) =>
        `<tr><td style="padding: 16px 40px 0 40px; font-size: 15px; color: #1a1a1a; line-height: 1.5;"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(message)}<br><span style="font-size: 13px; color: #6b7280;">${escapeHtml(payload.portfolioName)}</span></td></tr>`,
    )
    .join('');

  return {
    subject,
    html: buildEmailShell({
      innerHtml: `
        <tr><td style="padding: 28px 40px 0 40px;"><h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3;">${escapeHtml(subject)}</h1></td></tr>
        ${rows}
        <tr><td style="padding: 32px 40px 0 40px;"><a href="${link}" style="display: inline-block; background-color: #8b5cf6; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">${escapeHtml(t({ key: 'investments.watchlistAlert.emailCta', locale }))}</a></td></tr>
        <tr><td style="padding: 32px 40px 36px 40px;"><p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">${escapeHtml(t({ key: 'investments.watchlistAlert.emailFooter', locale }))}</p></td></tr>`,
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
