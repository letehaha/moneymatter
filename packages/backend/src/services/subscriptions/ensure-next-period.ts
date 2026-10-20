import { SUBSCRIPTION_PERIOD_STATUSES, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import { Op } from 'sequelize';

import { calculateNextDueDate } from './calculate-next-due-date';
import { finalizeInstallmentCompletion, isSubscriptionInstallmentCapReached } from './installments';
import { resolveOpenPeriodStatus } from './resolve-period-status';

/** Statuses that count as a live, un-consumed period (one is allowed at a time). */
export const OPEN_STATUSES = [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue];

/**
 * After a period is marked paid or skipped, ensures the next open period
 * exists. If an open period already exists (e.g. from a previous create cycle),
 * it is left untouched. Returns immediately when the installment cap has been
 * consumed.
 *
 * "Open" spans both `upcoming` and `overdue`: an open period that the cron (or a
 * past-dated schedule) has already flipped to `overdue` is still the schedule's
 * single live period, so it must block generation of a second one — guarding on
 * `upcoming` alone would let a duplicate open period appear.
 */
export async function ensureNextPeriodExists({ subscription }: { subscription: Subscriptions }) {
  const openPeriod = await SubscriptionPeriods.findOne({
    where: {
      subscriptionId: subscription.id,
      status: { [Op.in]: OPEN_STATUSES },
    },
  });

  if (openPeriod) return;

  // Stop generating once the schedule is fully consumed. For an installment that
  // also means the plan is finished, so finalize it (deactivate + stamp completedAt);
  // for subscriptions/bills this is a no-op and isActive is left to the user's toggle.
  if (await isSubscriptionInstallmentCapReached({ subscription })) {
    await finalizeInstallmentCompletion({ subscription });
    return;
  }

  const latestPeriod = await SubscriptionPeriods.findOne({
    where: { subscriptionId: subscription.id },
    order: [['dueDate', 'DESC']],
  });

  if (!latestPeriod) return;

  // anchorDay is derived from the initial dueDate when the subscription was
  // created. A latestPeriod only exists when dueDate was set, so anchorDay is
  // non-null here. Fall back to the latest period's own day-of-month if somehow
  // null (defensive only, not a reachable state in normal flow).
  const anchorDay = subscription.anchorDay ?? new Date(latestPeriod.dueDate + 'T00:00:00Z').getUTCDate();

  const nextDueDate = calculateNextDueDate({
    currentDueDate: latestPeriod.dueDate,
    frequency: subscription.frequency,
    anchorDay,
  });

  await SubscriptionPeriods.create({
    subscriptionId: subscription.id,
    dueDate: nextDueDate,
    status: resolveOpenPeriodStatus({ dueDate: nextDueDate }),
  });
}

/**
 * Re-evaluates an installment's completion after an edit that may have changed
 * its cap or its set of periods (raising/lowering `maxOccurrences`, moving the
 * schedule, reactivating). Decides on the COUNT OF CONSUMED periods (paid +
 * skipped) — not the total — so a freshly-seeded but unpaid period never
 * masquerades as a finished plan.
 *
 *  - Consumed >= maxOccurrences: the plan is fully consumed. Any open period
 *    left beyond the cap (e.g. after lowering `maxOccurrences`) is dropped and
 *    the installment is finalized (deactivated + `completedAt` stamped). Paid
 *    and skipped periods are immutable history and are never touched.
 *  - Consumed < maxOccurrences: room remains. A stale completion is cleared and
 *    the installment reactivated, then `ensureNextPeriodExists` guarantees a
 *    single open period so the schedule continues.
 *
 * No-op for non-installments — capped subscriptions/bills stop generating at the
 * cap (handled by `ensureNextPeriodExists`) but never "complete".
 */
export async function reconcileInstallmentCompletion({ subscription }: { subscription: Subscriptions }) {
  if (subscription.type !== SUBSCRIPTION_TYPES.installment) return;
  if (subscription.maxOccurrences == null) return;

  const consumedCount = await SubscriptionPeriods.count({
    where: {
      subscriptionId: subscription.id,
      status: { [Op.in]: [SUBSCRIPTION_PERIOD_STATUSES.paid, SUBSCRIPTION_PERIOD_STATUSES.skipped] },
    },
  });

  if (consumedCount >= subscription.maxOccurrences) {
    await SubscriptionPeriods.destroy({
      where: {
        subscriptionId: subscription.id,
        status: { [Op.in]: OPEN_STATUSES },
      },
    });
    await finalizeInstallmentCompletion({ subscription });
    return;
  }

  if (subscription.completedAt != null) {
    await subscription.update({ isActive: true, completedAt: null });
  }
  await ensureNextPeriodExists({ subscription });
}
