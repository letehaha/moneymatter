import { TAG_REMINDER_TYPES, TagReminderFrequency, TagReminderSettings, TagReminderType } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import TagReminders from '@models/tag-reminders.model';
import Tags from '@models/tags.model';
import { withTransaction } from '@services/common/with-transaction';
import { roundPositiveBaseAmount } from '@services/transactions/round-positive-amount';
import { Op } from 'sequelize';

const MAX_REMINDERS_PER_USER = 50;

/**
 * Rounds `settings.amountThreshold` to the owner's base currency, the currency it is stated in, so
 * the stored value, the duplicate check and the notification all see the same figure.
 */
const roundAmountThreshold = async ({
  userId,
  settings,
}: {
  userId: number;
  settings: TagReminderSettings;
}): Promise<TagReminderSettings> => {
  const { amountThreshold } = settings as { amountThreshold?: number };
  if (amountThreshold === undefined) return settings;

  const rounded = await roundPositiveBaseAmount({
    money: Money.fromDecimal(amountThreshold),
    userId,
    errorKey: 'tagReminders.amountThresholdRoundsToZero',
  });

  return { ...settings, amountThreshold: rounded.toNumber() };
};

interface CreateReminderPayload {
  userId: number;
  tagId: string;
  type: TagReminderType;
  frequency?: TagReminderFrequency | null; // `null` for realtime
  dayOfMonth?: number | null;
  settings?: TagReminderSettings;
  isEnabled?: boolean;
}

export const createReminder = withTransaction(async (payload: CreateReminderPayload) => {
  const { userId, tagId, type, frequency = null, dayOfMonth = null, isEnabled = true } = payload;

  // Verify tag exists and belongs to user
  await findOrThrowNotFound({
    query: Tags.findOne({ where: { id: tagId, userId } }),
    message: t({ key: 'tags.tagNotFound' }),
  });

  const settings = await roundAmountThreshold({ userId, settings: payload.settings ?? {} });

  // Check 50 reminder limit per user
  const userReminderCount = await TagReminders.count({ where: { userId } });
  if (userReminderCount >= MAX_REMINDERS_PER_USER) {
    throw new ValidationError({
      message: t({ key: 'tagReminders.maxRemindersReached' }),
    });
  }

  // Check if amountThreshold is required for amount_threshold type
  const amountThreshold = (settings as { amountThreshold?: number }).amountThreshold;
  if (type === TAG_REMINDER_TYPES.amountThreshold && !amountThreshold) {
    throw new ValidationError({
      message: t({ key: 'tagReminders.amountThresholdRequired' }),
    });
  }

  // Check for exact duplicate (same tag/type/frequency/dayOfMonth/settings)
  const existingReminder = await TagReminders.findOne({
    where: {
      tagId,
      type,
      frequency: frequency ?? null,
      dayOfMonth: dayOfMonth ?? null,
      settings,
    },
  });

  if (existingReminder) {
    throw new ConflictError({
      message: t({ key: 'tagReminders.reminderAlreadyExists' }),
    });
  }

  const reminder = await TagReminders.create({
    userId,
    tagId,
    type,
    frequency,
    dayOfMonth,
    settings: type === TAG_REMINDER_TYPES.amountThreshold ? { amountThreshold } : settings,
    isEnabled,
  });

  return reminder;
});

interface GetRemindersForTagPayload {
  userId: number;
  tagId: string;
}

export const getRemindersForTag = async ({ userId, tagId }: GetRemindersForTagPayload) => {
  // Verify tag exists and belongs to user
  await findOrThrowNotFound({
    query: Tags.findOne({ where: { id: tagId, userId } }),
    message: t({ key: 'tags.tagNotFound' }),
  });

  const reminders = await TagReminders.findAll({
    where: { tagId, userId },
    order: [['createdAt', 'ASC']],
  });

  return reminders;
};

interface GetReminderByIdPayload {
  id: string;
  userId: number;
  tagId: string;
}

export const getReminderById = async ({ id, userId, tagId }: GetReminderByIdPayload) => {
  const reminder = await findOrThrowNotFound({
    query: TagReminders.findOne({
      where: { id, userId, tagId },
      include: [{ model: Tags, as: 'tag' }],
    }),
    message: t({ key: 'tagReminders.reminderNotFound' }),
  });

  return reminder;
};

interface GetAllRemindersPayload {
  userId: number;
}

export const getAllReminders = async ({ userId }: GetAllRemindersPayload) => {
  const reminders = await TagReminders.findAll({
    where: { userId },
    include: [{ model: Tags, as: 'tag' }],
    order: [['createdAt', 'ASC']],
  });

  return reminders;
};

interface UpdateReminderPayload {
  id: string;
  userId: number;
  tagId: string;
  type?: TagReminderType;
  frequency?: TagReminderFrequency | null;
  dayOfMonth?: number | null;
  settings?: TagReminderSettings;
  isEnabled?: boolean;
}

export const updateReminder = withTransaction(async (payload: UpdateReminderPayload) => {
  const { id, userId, tagId, type, frequency, dayOfMonth, isEnabled } = payload;

  const reminder = await findOrThrowNotFound({
    query: TagReminders.findOne({ where: { id, userId, tagId } }),
    message: t({ key: 'tagReminders.reminderNotFound' }),
  });

  const settings =
    payload.settings === undefined ? undefined : await roundAmountThreshold({ userId, settings: payload.settings });

  const newType = type ?? reminder.type;
  const newFrequency = frequency !== undefined ? frequency : reminder.frequency;
  const newDayOfMonth = dayOfMonth !== undefined ? dayOfMonth : reminder.dayOfMonth;
  const newSettings = settings !== undefined ? settings : reminder.settings;

  // Check if amountThreshold is required for amount_threshold type
  const amountThreshold = (newSettings as { amountThreshold?: number }).amountThreshold;
  if (newType === TAG_REMINDER_TYPES.amountThreshold && !amountThreshold) {
    throw new ValidationError({
      message: t({ key: 'tagReminders.amountThresholdRequired' }),
    });
  }

  // Check for exact duplicate if any field is changing
  const hasChanges =
    type !== undefined || frequency !== undefined || dayOfMonth !== undefined || settings !== undefined;

  if (hasChanges) {
    const existingReminder = await TagReminders.findOne({
      where: {
        tagId: reminder.tagId,
        type: newType,
        frequency: newFrequency ?? null,
        dayOfMonth: newDayOfMonth ?? null,
        settings: newSettings ?? {},
        id: { [Op.ne]: id },
      },
    });

    if (existingReminder) {
      throw new ConflictError({
        message: t({ key: 'tagReminders.reminderAlreadyExists' }),
      });
    }
  }

  await reminder.update({
    ...(type !== undefined && { type }),
    ...(frequency !== undefined && { frequency }),
    ...(dayOfMonth !== undefined && { dayOfMonth }),
    ...(settings !== undefined && { settings }),
    ...(isEnabled !== undefined && { isEnabled }),
  });

  return reminder;
});

interface DeleteReminderPayload {
  id: string;
  userId: number;
  tagId: string;
}

export const deleteReminder = withTransaction(async ({ id, userId, tagId }: DeleteReminderPayload) => {
  const reminder = await findOrThrowNotFound({
    query: TagReminders.findOne({ where: { id, userId, tagId } }),
    message: t({ key: 'tagReminders.reminderNotFound' }),
  });

  await reminder.destroy();

  return { success: true };
});

/**
 * Get all enabled scheduled reminders.
 * Used by the cron job to find reminders that need to be checked.
 */
export const getEnabledScheduledReminders = async () => {
  const reminders = await TagReminders.findAll({
    where: {
      isEnabled: true,
      frequency: { [Op.ne]: null },
    },
    include: [{ model: Tags, as: 'tag' }],
  });

  return reminders;
};

/**
 * Get all enabled real-time reminders for specific tags and user.
 * Used when transactions are tagged to check for real-time triggers.
 */
const getEnabledRealTimeRemindersForTags = async ({ tagIds, userId }: { tagIds: string[]; userId: number }) => {
  if (tagIds.length === 0) return [];

  const reminders = await TagReminders.findAll({
    where: {
      tagId: { [Op.in]: tagIds },
      userId,
      isEnabled: true,
      frequency: null,
    },
    include: [{ model: Tags, as: 'tag' }],
  });

  return reminders;
};

interface UpdateReminderCheckTimesPayload {
  id: string;
  lastCheckedAt: Date;
  lastTriggeredAt?: Date | null;
}

/**
 * Update the check/trigger timestamps for a reminder.
 * Used by the cron job after processing a reminder.
 */
export const updateReminderCheckTimes = async ({
  id,
  lastCheckedAt,
  lastTriggeredAt,
}: UpdateReminderCheckTimesPayload) => {
  const reminder = await findOrThrowNotFound({
    query: TagReminders.findByPk(id),
    message: t({ key: 'tagReminders.reminderNotFound' }),
  });

  await reminder.update({
    lastCheckedAt,
    ...(lastTriggeredAt !== undefined && { lastTriggeredAt }),
  });

  return reminder;
};

/**
 * Trigger real-time reminders check for specific tags and user.
 * Non-blocking - errors are logged but don't propagate.
 * Called when transactions are tagged (during create, update, or addTransactionsToTag).
 */
export const triggerRealTimeRemindersForTags = async ({
  tagIds,
  userId,
}: {
  tagIds: string[];
  userId: number;
}): Promise<void> => {
  if (tagIds.length === 0) {
    return;
  }

  try {
    const reminders = await getEnabledRealTimeRemindersForTags({ tagIds, userId });

    if (reminders.length > 0) {
      // Dynamic import to avoid circular dependency
      const { checkRealTimeReminders } = await import('./check-reminders');
      const result = await checkRealTimeReminders({ reminders });

      if (result.triggered > 0) {
        logger.info(`Real-time reminders triggered for tags [${tagIds.join(', ')}]`, {
          triggered: result.triggered,
          skipped: result.skipped,
        });
      }
    }
  } catch (error) {
    logger.error({
      message: 'Failed to trigger real-time reminders',
      error: error as Error,
    });
  }
};

export { registerTagReminderListeners } from './event-listeners';
