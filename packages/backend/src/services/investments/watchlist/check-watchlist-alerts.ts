import {
  ASSET_CLASS,
  FEATURES,
  NOTIFICATION_TYPES,
  WATCHLIST_ALERT_FREQUENCIES,
  WATCHLIST_ALERT_TYPES,
  type WatchlistAlertNotificationPayload,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import WatchlistItems from '@models/investments/watchlist-items.model';
import { withTransaction } from '@services/common/with-transaction';
import { hasFeature } from '@services/entitlements/feature-trial.service';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';
import { startOfDayUtc } from '@services/investments/securities-price/pricing-anchor';
import * as notificationsService from '@services/notifications';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { subDays } from 'date-fns';
import { Op } from 'sequelize';

import { dailyChangePercent, isAlertConditionMet } from './alert-condition';
import { getDailyCloses, type SecurityDailyCloses } from './daily-closes';
import { serializeThreshold } from './get-watchlist.service';

/** A close older than this is stale (delisted, failing sync) and never fires an alert. */
const MAX_CLOSE_AGE_DAYS = 7;

type LoadedAlert = WatchlistAlerts & {
  item: WatchlistItems & { portfolio: Portfolios; security: Securities };
};

const formatPrice = ({ value }: { value: string }) => Money.fromDecimal(value).toString();

const describeTitle = ({ payload, locale }: { payload: WatchlistAlertNotificationPayload; locale: string }) => {
  const symbol = payload.symbol ?? '—';
  if (payload.type === WATCHLIST_ALERT_TYPES.dailyMove) {
    const sign = payload.changePercent > 0 ? '+' : '';
    return t({
      key: 'investments.watchlistAlert.dailyMove',
      variables: { symbol, change: `${sign}${payload.changePercent}` },
      locale,
    });
  }
  const variables = { symbol, price: formatPrice({ value: payload.price }), currency: payload.currencyCode };
  switch (payload.type) {
    case WATCHLIST_ALERT_TYPES.closeAbove:
      return t({ key: 'investments.watchlistAlert.closeAbove', variables, locale });
    case WATCHLIST_ALERT_TYPES.closeBelow:
      return t({ key: 'investments.watchlistAlert.closeBelow', variables, locale });
    default:
      payload satisfies never;
      throw new Error('Unknown watchlist alert type');
  }
};

export const describeAlert = ({ payload, locale }: { payload: WatchlistAlertNotificationPayload; locale: string }) => ({
  title: describeTitle({ payload, locale }),
  message: t({
    key: 'investments.watchlistAlert.message',
    variables: {
      date: payload.closeDate,
      close: formatPrice({ value: payload.close }),
      currency: payload.currencyCode,
    },
    locale,
  }),
});

const buildPayload = ({
  alert,
  closes,
}: {
  alert: LoadedAlert;
  closes: SecurityDailyCloses;
}): WatchlistAlertNotificationPayload => {
  const { item } = alert;
  const change = dailyChangePercent({ closes });
  const changePercent = change === null ? null : Number(change.toFixed(2));
  const base = {
    portfolioId: item.portfolio.id,
    portfolioName: item.portfolio.name,
    itemId: item.id,
    alertId: alert.id,
    securityId: item.security.id,
    symbol: item.security.symbol ?? item.security.name,
    currencyCode: item.security.currencyCode,
    close: closes.last.price,
    previousClose: closes.previous?.price ?? null,
    closeDate: closes.last.day,
  };

  const threshold = serializeThreshold({ alert });
  // A daily move only fires with a previous close, so its change is known.
  if (threshold.type === WATCHLIST_ALERT_TYPES.dailyMove)
    return { ...base, ...threshold, changePercent: changePercent! };
  return { ...base, ...threshold, changePercent };
};

/**
 * The conditional update is the claim: it only matches while this close is unevaluated, so two
 * concurrent runs can't both fire on it. The in-app notification commits together with the claim.
 */
const evaluateAlert = withTransaction(
  async ({
    alert,
    closes,
    locale,
  }: {
    alert: LoadedAlert;
    closes: SecurityDailyCloses;
    locale: string;
  }): Promise<WatchlistAlertNotificationPayload | null> => {
    const conditionMet = isAlertConditionMet({ alert, closes });
    const isOnce = alert.frequency === WATCHLIST_ALERT_FREQUENCIES.once;
    const payload = conditionMet && (isOnce || alert.isArmed) ? buildPayload({ alert, closes }) : null;
    const day = closes.last.day;

    const [claimed] = await WatchlistAlerts.update(
      {
        lastEvaluatedPriceDate: day,
        isArmed: !conditionMet,
        ...(payload && {
          lastTriggeredAt: new Date(),
          isActive: !isOnce,
          ...(alert.notifyEmail && { pendingEmailPayload: payload }),
        }),
      },
      {
        where: {
          id: alert.id,
          isActive: true,
          [Op.or]: [{ lastEvaluatedPriceDate: null }, { lastEvaluatedPriceDate: { [Op.lt]: day } }],
        },
      },
    );
    if (!claimed || !payload) return null;

    if (alert.notifyInApp) {
      await notificationsService.createNotification({
        userId: alert.item.portfolio.userId,
        type: NOTIFICATION_TYPES.watchlistAlert,
        ...describeAlert({ payload, locale }),
        payload,
      });
    }
    return payload;
  },
);

const checkUser = async ({
  userId,
  pending,
  result,
}: {
  userId: number;
  pending: { alert: LoadedAlert; closes: SecurityDailyCloses }[];
  result: { fired: number; failed: number };
}) => {
  let locale: string;
  try {
    if (!hasFeature({ entitlements: await getEntitlementsByUserId({ userId }), feature: FEATURES.watchlist })) return;
    locale = (await getUserSettings({ userId })).locale;
  } catch (error) {
    result.failed += pending.length;
    logger.error(
      { message: 'Watchlist alert check failed to load the user', error: error as Error },
      { code: 'WATCHLIST_ALERT_USER_FAILED', userId },
    );
    return;
  }

  for (const { alert, closes } of pending) {
    try {
      if (await evaluateAlert({ alert, closes, locale })) result.fired += 1;
    } catch (error) {
      result.failed += 1;
      logger.error(
        { message: 'Watchlist alert check failed', error: error as Error },
        { code: 'WATCHLIST_ALERT_FAILED', userId, alertId: alert.id },
      );
    }
  }
};

/**
 * Evaluates active alerts against the latest daily close, once per close. Runs after each price sync:
 * `crypto` picks crypto securities, otherwise everything else.
 */
export const checkWatchlistAlerts = async ({ crypto }: { crypto: boolean }) => {
  const today = startOfDayUtc(new Date());
  const latestCloseDay = toUtcDateString(subDays(today, 1));
  const alerts = (await WatchlistAlerts.findAll({
    where: {
      isActive: true,
      [Op.or]: [{ lastEvaluatedPriceDate: null }, { lastEvaluatedPriceDate: { [Op.lt]: latestCloseDay } }],
    },
    include: [
      {
        model: WatchlistItems,
        required: true,
        include: [
          { model: Portfolios, required: true, attributes: ['id', 'name', 'userId'] },
          {
            model: Securities,
            required: true,
            where: { assetClass: crypto ? ASSET_CLASS.crypto : { [Op.ne]: ASSET_CLASS.crypto } },
          },
        ],
      },
    ],
  })) as LoadedAlert[];
  const result = { alertsChecked: alerts.length, fired: 0, failed: 0 };
  if (!alerts.length) return result;

  const closesBySecurity = await getDailyCloses({
    securityIds: [...new Set(alerts.map((alert) => alert.item.securityId))],
    since: subDays(new Date(), MAX_CLOSE_AGE_DAYS * 2),
  });
  const oldestFreshDay = toUtcDateString(subDays(today, MAX_CLOSE_AGE_DAYS));
  const pending = alerts.flatMap((alert) => {
    const closes = closesBySecurity.get(alert.item.securityId);
    if (!closes || closes.last.day < oldestFreshDay) return [];
    if (alert.lastEvaluatedPriceDate && alert.lastEvaluatedPriceDate >= closes.last.day) return [];
    return [{ alert, closes }];
  });

  for (const [userId, userPending] of Map.groupBy(pending, ({ alert }) => alert.item.portfolio.userId)) {
    await checkUser({ userId, pending: userPending, result });
  }
  return result;
};

/** For the price sync crons: a failed check is logged and reported, never failing the sync. */
export const checkWatchlistAlertsAfterSync = async ({ crypto }: { crypto: boolean }) => {
  try {
    const { alertsChecked, fired, failed } = await checkWatchlistAlerts({ crypto });
    return { watchlistAlertsChecked: alertsChecked, watchlistAlertsFired: fired, watchlistAlertsFailed: failed };
  } catch (error) {
    logger.error(
      { message: 'Watchlist alert check failed', error: error as Error },
      { code: 'WATCHLIST_ALERT_CHECK_FAILED' },
    );
    return { watchlistAlertCheckFailed: true };
  }
};
