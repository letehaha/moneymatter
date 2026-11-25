import {
  type CreateWatchlistAlertBody,
  type RecordId,
  type UpdateWatchlistAlertBody,
  WATCHLIST_ALERT_FREQUENCIES,
  WATCHLIST_ALERT_TYPES,
  WATCHLIST_LIMITS,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import WatchlistAlerts from '@models/investments/watchlist-alerts.model';
import { withTransaction } from '@services/common/with-transaction';
import { getPortfolio } from '@services/investments/portfolios/get.service';

import { alertThreshold, alertThresholdInvalidError, isAlertConditionMet } from './alert-condition';
import { getDailyCloses } from './daily-closes';
import { serializeAlert } from './get-watchlist.service';
import { findItem } from './items.service';

interface ItemParams {
  userId: number;
  portfolioId: RecordId;
  itemId: RecordId;
}

const findAlertItem = async ({ userId, portfolioId, itemId }: ItemParams) => {
  const portfolio = await getPortfolio({ userId, portfolioId });
  return findItem({ portfolioId: portfolio.id, itemId });
};

const findAlert = async ({ alertId, ...params }: ItemParams & { alertId: RecordId }) => {
  const item = await findAlertItem(params);
  const alert = await findOrThrowNotFound({
    query: WatchlistAlerts.findOne({ where: { id: alertId, itemId: item.id } }),
    message: t({ key: 'investments.watchlist.alertNotFound' }),
  });
  return { item, alert };
};

/** An `every_time` alert whose condition already holds on the latest close waits for the price to cross back first. */
const rearm = async ({ alert, securityId }: { alert: WatchlistAlerts; securityId: RecordId }) => {
  const closes = (await getDailyCloses({ securityIds: [securityId] })).get(securityId);
  alert.isArmed =
    alert.frequency === WATCHLIST_ALERT_FREQUENCIES.once || !closes || !isAlertConditionMet({ alert, closes });
};

/** `undefined` leaves a field untouched; a threshold of the other alert type is rejected. */
const applyFields = ({ alert, fields }: { alert: WatchlistAlerts; fields: UpdateWatchlistAlertBody }) => {
  const isMove = alert.type === WATCHLIST_ALERT_TYPES.dailyMove;
  if (fields.price !== undefined) {
    if (isMove) throw alertThresholdInvalidError();
    alert.price = Money.fromDecimal(fields.price);
  }
  if (fields.percent !== undefined) {
    if (!isMove) throw alertThresholdInvalidError();
    alert.percent = fields.percent;
  }
  if (fields.frequency !== undefined) alert.frequency = fields.frequency;
  if (fields.notifyInApp !== undefined) alert.notifyInApp = fields.notifyInApp;
  if (fields.notifyEmail !== undefined) alert.notifyEmail = fields.notifyEmail;
  if (fields.isActive !== undefined) alert.isActive = fields.isActive;
  if (fields.notifyEmail === false || fields.isActive === false) alert.pendingEmailPayload = null;

  // Throws when the alert lacks its type's threshold.
  alertThreshold({ alert });
  if (!alert.notifyInApp && !alert.notifyEmail) {
    throw new ValidationError({ message: t({ key: 'investments.watchlist.alertChannelRequired' }) });
  }
};

export const createAlert = withTransaction(
  async ({ userId, portfolioId, itemId, ...fields }: ItemParams & CreateWatchlistAlertBody) => {
    const item = await findAlertItem({ userId, portfolioId, itemId });
    if ((await WatchlistAlerts.count({ where: { itemId: item.id } })) >= WATCHLIST_LIMITS.maxAlertsPerItem) {
      throw new ValidationError({
        message: t({
          key: 'investments.watchlist.tooManyAlerts',
          variables: { max: WATCHLIST_LIMITS.maxAlertsPerItem },
        }),
      });
    }
    const alert = WatchlistAlerts.build({
      itemId: item.id,
      type: fields.type,
      frequency: WATCHLIST_ALERT_FREQUENCIES.once,
    });
    applyFields({ alert, fields });
    await rearm({ alert, securityId: item.securityId });
    await alert.save();
    return serializeAlert({ alert });
  },
);

/** A changed threshold or frequency, or turning the alert back on, re-arms it against the latest close. */
export const updateAlert = withTransaction(
  async ({
    userId,
    portfolioId,
    itemId,
    alertId,
    ...fields
  }: ItemParams & { alertId: RecordId } & UpdateWatchlistAlertBody) => {
    const { item, alert } = await findAlert({ userId, portfolioId, itemId, alertId });
    applyFields({ alert, fields });
    if (alert.changed('price') || alert.changed('percent') || alert.changed('frequency') || alert.changed('isActive')) {
      await rearm({ alert, securityId: item.securityId });
    }
    await alert.save();
    return serializeAlert({ alert });
  },
);

export const deleteAlert = withTransaction(async (params: ItemParams & { alertId: RecordId }): Promise<void> => {
  const { alert } = await findAlert(params);
  await alert.destroy();
});
