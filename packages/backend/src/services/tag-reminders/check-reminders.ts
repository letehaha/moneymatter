import {
  AmountThresholdSettings,
  NOTIFICATION_TYPES,
  TAG_REMINDER_FREQUENCIES,
  TAG_REMINDER_TYPES,
  TagReminderNotificationPayload,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import TagReminders from '@models/tag-reminders.model';
import * as Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import * as notificationsService from '@services/notifications';

import { getEnabledScheduledReminders, updateReminderCheckTimes } from './index';

/**
 * Check if a reminder should be triggered today based on its frequency.
 */
export function shouldCheckReminderToday({ reminder }: { reminder: TagReminders }): boolean {
  const now = new Date();
  const today = now.getDate();
  const currentDayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  if (!reminder.frequency) {
    // Real-time reminders should NOT be checked by the daily cron
    // They are triggered immediately when transactions are tagged
    return false;
  }

  switch (reminder.frequency) {
    case TAG_REMINDER_FREQUENCIES.daily:
      // Daily - always check
      return true;

    case TAG_REMINDER_FREQUENCIES.weekly:
      // Weekly - check on Mondays (or any consistent day)
      return currentDayOfWeek === 1;

    case TAG_REMINDER_FREQUENCIES.monthly:
    case TAG_REMINDER_FREQUENCIES.quarterly:
    case TAG_REMINDER_FREQUENCIES.yearly: {
      // Check on specific day of month
      const effectiveDay = reminder.dayOfMonth ?? 1;
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      const targetDay = Math.min(effectiveDay, lastDayOfMonth);

      if (today !== targetDay) {
        return false;
      }

      // For quarterly, only check in Jan, Apr, Jul, Oct
      if (reminder.frequency === TAG_REMINDER_FREQUENCIES.quarterly) {
        return [0, 3, 6, 9].includes(currentMonth);
      }

      // For yearly, only check in January
      if (reminder.frequency === TAG_REMINDER_FREQUENCIES.yearly) {
        return currentMonth === 0;
      }

      return true;
    }

    default:
      return false;
  }
}

/**
 * Get the date range for a scheduled reminder based on its frequency.
 */
export function getDateRangeForScheduledReminder({ reminder }: { reminder: TagReminders }): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);

  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  if (!reminder.frequency) {
    // No frequency means real-time - use current month
    from.setDate(1);
    return { from, to };
  }

  switch (reminder.frequency) {
    case TAG_REMINDER_FREQUENCIES.daily:
      // Look back 1 day
      from.setDate(from.getDate() - 1);
      break;

    case TAG_REMINDER_FREQUENCIES.weekly:
      // Look back 7 days, then adjust by 1 to get a 7-day span (not 8)
      from.setDate(from.getDate() - 7);
      from.setDate(from.getDate() + 1);
      break;

    case TAG_REMINDER_FREQUENCIES.monthly:
      // Look back 1 month, then adjust by 1 to get proper month span
      from.setMonth(from.getMonth() - 1);
      from.setDate(from.getDate() + 1);
      break;

    case TAG_REMINDER_FREQUENCIES.quarterly:
      // Look back 3 months, then adjust by 1 to get proper quarter span
      from.setMonth(from.getMonth() - 3);
      from.setDate(from.getDate() + 1);
      break;

    case TAG_REMINDER_FREQUENCIES.yearly:
      // Look back 1 year
      from.setFullYear(from.getFullYear() - 1);
      break;

    default:
      // Fallback: look back 1 day
      from.setDate(from.getDate() - 1);
  }

  return { from, to };
}

/**
 * Get the date range for real-time reminders.
 * Uses current calendar month (1st to today).
 */
export function getDateRangeForRealTimeReminder(): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);

  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  from.setHours(0, 0, 0, 0);

  return { from, to };
}

interface CheckResult {
  reminderId: string;
  tagId: string;
  tagName: string;
  userId: number;
  triggered: boolean;
  reason?: string;
  transactionCount?: number;
  totalAmount?: Money;
  transactionIds?: string[];
}

/**
 * Check a single reminder and determine if it should trigger.
 * For existence_check type with lastTriggeredAt, only looks at transactions created after that date.
 */
async function checkReminder({
  reminder,
  from,
  to,
}: {
  reminder: TagReminders;
  from: Date;
  to: Date;
}): Promise<CheckResult> {
  const tag = reminder.tag;
  const result: CheckResult = {
    reminderId: reminder.id,
    tagId: reminder.tagId,
    tagName: tag?.name ?? 'Unknown',
    userId: reminder.userId,
    triggered: false,
  };

  // Get transactions with this tag in the date range
  // For existence_check, we only need to know if any exist (limit 1 is sufficient)
  // For amount_threshold, we need all transactions to calculate the sum
  const isExistenceCheck = reminder.type === TAG_REMINDER_TYPES.existenceCheck;

  // For existence_check, use lastTriggeredAt as start date if available
  // This ensures we only notify about NEW transactions since last trigger
  let effectiveFrom = from;
  if (isExistenceCheck && reminder.lastTriggeredAt) {
    const lastTriggered = new Date(reminder.lastTriggeredAt);
    // Add 1 second to avoid including the transaction that triggered last time
    lastTriggered.setSeconds(lastTriggered.getSeconds() + 1);
    effectiveFrom = lastTriggered;
  }

  const transactions = await Transactions.findWithFilters({
    access: { creator: reminder.userId },
    startDate: effectiveFrom.toISOString(),
    endDate: to.toISOString(),
    tagIds: [reminder.tagId],
    planned: 'exclude',
    balanceAdjustments: 'include',
    // 'all', not a page: the amount threshold sums every matching row.
    completeness: isExistenceCheck ? 'probe' : 'all',
  });

  switch (reminder.type) {
    case TAG_REMINDER_TYPES.amountThreshold: {
      // Calculate totals for amount threshold check
      const transactionCount = transactions.length;
      const totalAmount = Money.sum(transactions.map((tx) => tx.refAmount));
      const transactionIds = transactions.map((tx) => tx.id);

      result.transactionCount = transactionCount;
      result.totalAmount = totalAmount;
      result.transactionIds = transactionIds;

      // Trigger if total amount exceeds threshold
      const amountThreshold = (reminder.settings as AmountThresholdSettings)?.amountThreshold;
      if (amountThreshold && totalAmount.greaterThan(Money.fromDecimal(amountThreshold))) {
        result.triggered = true;
        result.reason = `Total amount (${totalAmount.toNumber()}) exceeds threshold (${amountThreshold})`;
      }
      break;
    }

    case TAG_REMINDER_TYPES.existenceCheck:
      // Trigger if there ARE transactions with this tag (reminder to review)
      // We only fetched 1 transaction to check existence, so count is 0 or 1
      if (transactions.length > 0) {
        result.triggered = true;
        result.transactionCount = 1; // At least 1 exists
        result.reason = 'Found transaction(s) with this tag';
      }
      break;
  }

  return result;
}

/**
 * Create a notification for a triggered reminder.
 */
async function createReminderNotification({
  reminder,
  checkResult,
}: {
  reminder: TagReminders;
  checkResult: CheckResult;
}): Promise<void> {
  // Get user's base currency for display
  let currencyCode = 'USD';
  try {
    const baseCurrency = await UsersCurrencies.getBaseCurrency({ userId: reminder.userId });
    currencyCode = baseCurrency.currency.code;
  } catch {
    // Default to USD if not found
  }

  const amountThreshold = (reminder.settings as AmountThresholdSettings)?.amountThreshold || undefined;
  const actualAmount = checkResult.totalAmount?.isZero() === false ? checkResult.totalAmount.toNumber() : undefined;

  const tag = reminder.tag;

  const payload: TagReminderNotificationPayload = {
    tagId: reminder.tagId,
    tagName: checkResult.tagName,
    tagColor: tag?.color ?? null,
    tagIcon: tag?.icon ?? null,
    reminderType: reminder.type,
    schedule: {
      frequency: reminder.frequency,
      dayOfMonth: reminder.dayOfMonth,
    },
    thresholdAmount: amountThreshold,
    actualAmount,
    transactionCount: checkResult.transactionCount,
    currencyCode,
    transactionIds: checkResult.transactionIds,
  };

  let title: string;
  let message: string;

  switch (reminder.type) {
    case TAG_REMINDER_TYPES.amountThreshold:
      title = t({ key: 'tagReminders.notifications.thresholdExceeded.title' });
      message = t({
        key: 'tagReminders.notifications.thresholdExceeded.message',
        variables: {
          tagName: checkResult.tagName,
          actualAmount: String(actualAmount),
          thresholdAmount: String(amountThreshold),
        },
      });
      break;

    case TAG_REMINDER_TYPES.existenceCheck:
      title = t({ key: 'tagReminders.notifications.existenceCheck.title' });
      message = t({
        key: 'tagReminders.notifications.existenceCheck.message',
        variables: {
          tagName: checkResult.tagName,
          count: String(checkResult.transactionCount),
        },
      });
      break;

    default:
      title = 'Tag Reminder';
      message = `Reminder for tag "${checkResult.tagName}"`;
  }

  await notificationsService.createNotification({
    userId: reminder.userId,
    type: NOTIFICATION_TYPES.tagReminder,
    title,
    message,
    payload,
  });
}

interface CheckRemindersResult {
  totalChecked: number;
  triggered: number;
  skipped: number;
  errors: number;
  results: CheckResult[];
}

/**
 * Check all enabled scheduled reminders.
 * This is the main function called by the daily cron job.
 */
export async function checkScheduledReminders(): Promise<CheckRemindersResult> {
  logger.info('Starting scheduled tag reminders check');

  const result: CheckRemindersResult = {
    totalChecked: 0,
    triggered: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  try {
    const reminders = await getEnabledScheduledReminders();
    logger.info(`Found ${reminders.length} enabled scheduled reminders`);

    for (const reminder of reminders) {
      // Check if this reminder should be checked today
      if (!shouldCheckReminderToday({ reminder })) {
        result.skipped++;
        continue;
      }

      result.totalChecked++;

      try {
        const { from, to } = getDateRangeForScheduledReminder({ reminder });
        logger.info(`Checking reminder ${reminder.id} for date range: ${from.toISOString()} - ${to.toISOString()}`);

        const checkResult = await checkReminder({ reminder, from, to });
        result.results.push(checkResult);

        const now = new Date();

        if (checkResult.triggered) {
          result.triggered++;
          await createReminderNotification({ reminder, checkResult });
          await updateReminderCheckTimes({
            id: reminder.id,
            lastCheckedAt: now,
            lastTriggeredAt: now,
          });
          logger.info(`Reminder ${reminder.id} triggered: ${checkResult.reason}`);
        } else {
          await updateReminderCheckTimes({
            id: reminder.id,
            lastCheckedAt: now,
          });
        }
      } catch (error) {
        result.errors++;
        logger.error({
          message: `Error checking reminder ${reminder.id}`,
          error: error as Error,
        });
      }
    }

    logger.info(
      `Tag reminders check completed: ${result.totalChecked} checked, ${result.triggered} triggered, ${result.skipped} skipped, ${result.errors} errors`,
    );
  } catch (error) {
    logger.error({
      message: 'Error in checkScheduledReminders',
      error: error as Error,
    });
    throw error;
  }

  return result;
}

const REALTIME_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check real-time reminders for given tags.
 * Called when transactions are tagged.
 * Uses 24h cooldown to prevent notification spam.
 */
export async function checkRealTimeReminders({
  reminders,
}: {
  reminders: TagReminders[];
}): Promise<CheckRemindersResult> {
  const result: CheckRemindersResult = {
    totalChecked: 0,
    triggered: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  const { from, to } = getDateRangeForRealTimeReminder();

  for (const reminder of reminders) {
    // Check 24h cooldown
    if (reminder.lastTriggeredAt) {
      const timeSinceLastTrigger = Date.now() - new Date(reminder.lastTriggeredAt).getTime();
      if (timeSinceLastTrigger < REALTIME_COOLDOWN_MS) {
        result.skipped++;
        continue;
      }
    }

    result.totalChecked++;

    try {
      const checkResult = await checkReminder({ reminder, from, to });
      result.results.push(checkResult);

      const now = new Date();

      if (checkResult.triggered) {
        result.triggered++;
        await createReminderNotification({ reminder, checkResult });
        await updateReminderCheckTimes({
          id: reminder.id,
          lastCheckedAt: now,
          lastTriggeredAt: now,
        });
        logger.info(`Real-time reminder ${reminder.id} triggered: ${checkResult.reason}`);
      }
    } catch (error) {
      result.errors++;
      logger.error({
        message: `Error checking real-time reminder ${reminder.id}`,
        error: error as Error,
      });
    }
  }

  return result;
}
