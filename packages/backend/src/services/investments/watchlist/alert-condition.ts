import { WATCHLIST_ALERT_TYPES, type WatchlistAlertThreshold, type WatchlistAlertType } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Big from 'big.js';

import type { SecurityDailyCloses } from './daily-closes';

interface AlertRow {
  type: WatchlistAlertType;
  price: Money | null;
  percent: number | null;
}

export const alertThresholdInvalidError = () =>
  new ValidationError({ message: t({ key: 'investments.watchlist.alertThresholdInvalid' }) });

const dailyChange = ({ closes }: { closes: SecurityDailyCloses }) => {
  if (!closes.previous) return null;
  const previous = new Big(closes.previous.price);
  if (!previous.gt(0)) return null;
  return { previous, delta: new Big(closes.last.price).minus(previous) };
};

/** Percent-point change from the previous close to the last one; null without a usable previous close. */
export const dailyChangePercent = ({ closes }: { closes: SecurityDailyCloses }): number | null => {
  const change = dailyChange({ closes });
  return change && change.delta.times(100).div(change.previous).toNumber();
};

/** Throws a ValidationError when the row lacks the threshold its type needs. */
export const alertThreshold = ({ alert }: { alert: AlertRow }): WatchlistAlertThreshold<Money> => {
  switch (alert.type) {
    case WATCHLIST_ALERT_TYPES.dailyMove:
      if (alert.percent === null) throw alertThresholdInvalidError();
      return { type: alert.type, percent: alert.percent, price: null };
    case WATCHLIST_ALERT_TYPES.closeAbove:
    case WATCHLIST_ALERT_TYPES.closeBelow:
      if (alert.price === null) throw alertThresholdInvalidError();
      return { type: alert.type, price: alert.price, percent: null };
    default:
      throw new Error(`Unknown watchlist alert type: ${alert.type satisfies never}`);
  }
};

export const isAlertConditionMet = ({ alert, closes }: { alert: AlertRow; closes: SecurityDailyCloses }): boolean => {
  const threshold = alertThreshold({ alert });
  switch (threshold.type) {
    case WATCHLIST_ALERT_TYPES.dailyMove: {
      const change = dailyChange({ closes });
      return change !== null && change.delta.abs().times(100).gte(change.previous.times(threshold.percent));
    }
    case WATCHLIST_ALERT_TYPES.closeAbove:
      return Money.fromDecimal(closes.last.price).gte(threshold.price);
    case WATCHLIST_ALERT_TYPES.closeBelow:
      return Money.fromDecimal(closes.last.price).lte(threshold.price);
  }
};
