import {
  NOTIFICATION_TYPES,
  REMIND_BEFORE_DAYS,
  RemindBeforePreset,
  SUBSCRIPTION_PERIOD_STATUSES,
} from '@bt/shared/types';
import { moneyToApiDecimalOrNull } from '@common/types/money';
import { logger } from '@js/utils/logger';
import SubscriptionPeriodNotifications from '@models/subscription-period-notifications.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import * as notificationsService from '@services/notifications';
import { Op } from 'sequelize';

import { queueSubscriptionReminderEmail } from './reminder-email-queue';

interface CheckResult {
  overdueUpdated: number;
  remindersSent: number;
}

/**
 * Entry point called by the subscription reminders cron.
 * 1. Flips upcoming periods whose due date has passed to `overdue`.
 * 2. Sends "remind before" notifications (in-app + optional email queue).
 *
 * Overdue marking runs first so a `0_days` ("on the due date") reminder still
 * fires after the period flips to `overdue` — the notification pass loads both
 * statuses, which is why the order matters here.
 *
 * Not wrapped in a transaction: `createNotification` manages its own, and the
 * `(periodId, remindBeforePreset)` dedup table keeps re-runs idempotent.
 */
export async function checkSubscriptionReminders(): Promise<CheckResult> {
  const today = new Date().toISOString().split('T')[0]!;
  const overdueUpdated = await markOverduePeriods({ today });
  const remindersSent = await sendRemindBeforeNotifications({ today });

  return { overdueUpdated, remindersSent };
}

/**
 * Find all upcoming periods whose due date has passed and mark them overdue.
 */
async function markOverduePeriods({ today }: { today: string }): Promise<number> {
  const [updatedCount] = await SubscriptionPeriods.update(
    { status: SUBSCRIPTION_PERIOD_STATUSES.overdue },
    {
      where: {
        status: SUBSCRIPTION_PERIOD_STATUSES.upcoming,
        dueDate: { [Op.lt]: today },
      },
    },
  );

  if (updatedCount > 0) {
    logger.info(`[Subscription Reminders] Marked ${updatedCount} periods as overdue`);
  }

  return updatedCount;
}

/**
 * Check open periods against their subscription's remindBefore presets and send
 * notifications that haven't been sent yet.
 *
 * Targets both `upcoming` and `overdue` periods. `markOverduePeriods` runs first
 * in `checkSubscriptionReminders` and flips any period whose dueDate < today to
 * `overdue`. The `0_days` ("on the due date") preset fires when today >= dueDate;
 * if the first cron run after the due date lands once the period has already gone
 * `overdue`, an `upcoming`-only filter would never see it and the on-due-date
 * notification would be lost. Including `overdue` closes that gap. The
 * `(periodId, remindBeforePreset)` dedup table makes the wider net safe — every
 * preset still sends at most once per period.
 *
 * Per (period, preset) the dedup row is written FIRST to claim the slot, then the
 * in-app notification fires and the email is queued. `emailSent` flips to `true`
 * only in the email worker, once the send actually succeeds — so a row with
 * `emailSent: false` (enqueue failed, or the worker exhausted its retries) is an
 * email-only retry on a later run: the email is re-queued without re-firing the
 * in-app notification.
 */
async function sendRemindBeforeNotifications({ today }: { today: string }): Promise<number> {
  let sent = 0;

  const subscriptions = await Subscriptions.findAll({
    where: {
      isActive: true,
      remindBefore: { [Op.ne]: [] },
    },
    include: [
      {
        model: SubscriptionPeriods,
        as: 'periods',
        where: {
          status: { [Op.in]: [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue] },
        },
        required: false,
      },
    ],
  });

  for (const subscription of subscriptions) {
    for (const period of subscription.periods) {
      for (const preset of subscription.remindBefore) {
        try {
          const daysBeforeDue = REMIND_BEFORE_DAYS[preset as RemindBeforePreset];
          if (daysBeforeDue === undefined) continue;

          // Calculate when this notification should fire
          const dueDate = new Date(period.dueDate + 'T00:00:00Z');
          const triggerDate = new Date(dueDate);
          triggerDate.setUTCDate(triggerDate.getUTCDate() - daysBeforeDue);
          const triggerDateStr = triggerDate.toISOString().split('T')[0]!;

          // Should we trigger? Only if today >= trigger date
          if (today < triggerDateStr) continue;

          // The dedup row is the slot for this (period, preset). Its presence means
          // the in-app notification has already been fired; `emailSent` separately
          // tracks whether the email was actually delivered (flipped by the worker).
          const existing = await SubscriptionPeriodNotifications.findOne({
            where: {
              periodId: period.id,
              remindBeforePreset: preset,
            },
            attributes: ['id', 'emailSent'],
          });

          // Already fully handled: in-app fired and (if applicable) the email was
          // delivered or this subscription has email off. While `emailSent` is
          // still false (delivery pending or a previous send failed), the run falls
          // through to re-queue the email.
          if (existing && (existing.emailSent || !subscription.notifyEmail)) continue;

          // expectedAmount on the model is raw cents (BIGINT).
          const expectedDecimal = moneyToApiDecimalOrNull(subscription.expectedAmount);

          // Claim the slot BEFORE firing the in-app notification or queuing the
          // email. Writing the row first guarantees a later failure can't make the
          // next cron run re-fire the in-app notification — the row already exists.
          // A fresh row starts with `emailSent: false`; the worker flips it to
          // `true` only after the email is actually delivered, so an undelivered
          // email gets re-attempted on a later run without re-firing the in-app
          // notification.
          const dedupRow =
            existing ??
            (await SubscriptionPeriodNotifications.create({
              periodId: period.id,
              remindBeforePreset: preset,
              emailSent: false,
              emailError: null,
            }));

          // Fire the in-app notification only when claiming a brand-new slot. An
          // existing row reaching this point is an email-only retry, so skipping
          // it here avoids a duplicate in-app notification.
          if (!existing) {
            await notificationsService.createNotification({
              userId: subscription.userId,
              type: NOTIFICATION_TYPES.subscriptionReminder,
              title: `Payment reminder: ${subscription.name}`,
              message: `"${subscription.name}" is due on ${period.dueDate}`,
              payload: {
                subscriptionId: subscription.id,
                periodId: period.id,
                dueDate: period.dueDate,
                preset,
                expectedAmount: expectedDecimal,
                currencyCode: subscription.expectedCurrencyCode,
              },
            });
          }

          // Queue email if enabled. `emailSent` is NOT flipped here: enqueuing only
          // adds the job to the queue, so the worker is the source of truth for
          // delivery and flips `emailSent: true` once the send succeeds (or is an
          // intentional no-op). The row stays `emailSent: false` until then, so a
          // worker that exhausts its retries leaves it re-queueable on a later run.
          // An enqueue failure here (e.g. Redis down) records the error and likewise
          // leaves the row re-queueable.
          if (subscription.notifyEmail) {
            try {
              await queueSubscriptionReminderEmail({
                userId: subscription.userId,
                subscriptionId: subscription.id,
                periodId: period.id,
                remindBeforePreset: preset,
                subscriptionName: subscription.name,
                dueDate: period.dueDate,
                expectedAmount: expectedDecimal,
                currencyCode: subscription.expectedCurrencyCode,
              });
            } catch (err) {
              await dedupRow.update({ emailError: (err as Error).message });
              logger.error({
                message: `[Subscription Reminders] Failed to queue email for subscription ${subscription.id}`,
                error: err as Error,
              });
            }
          }

          sent++;
        } catch (error) {
          logger.error({
            message: `[Subscription Reminders] Error processing notification for period ${period.id}, preset ${preset}`,
            error: error as Error,
          });
        }
      }
    }
  }

  if (sent > 0) {
    logger.info(`[Subscription Reminders] Sent ${sent} notifications`);
  }

  return sent;
}
