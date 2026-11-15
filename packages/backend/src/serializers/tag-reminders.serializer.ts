/**
 * TagReminders Serializers
 *
 * Maps reminders from the model to the API. `settings.amountThreshold` lives in a JSON column
 * (not a @MoneyField column) and is stored as the same decimal the API speaks, in the user's base
 * currency, so the settings pass through unchanged.
 */
import type TagReminders from '@models/tag-reminders.model';

// ============================================================================
// Response Types (API format with DecimalAmount)
// ============================================================================

interface TagReminderSettingsApiResponse {
  amountThreshold?: number;
  [key: string]: unknown;
}

interface TagReminderApiResponse {
  id: string;
  userId: number;
  tagId: string;
  type: string;
  frequency: string | null;
  dayOfMonth: number | null;
  settings: TagReminderSettingsApiResponse;
  isEnabled: boolean;
  lastCheckedAt: Date | null;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

/**
 * Serialize a tag reminder from DB format to API response
 */
export function serializeTagReminder(reminder: TagReminders): TagReminderApiResponse {
  return {
    id: reminder.id,
    userId: reminder.userId,
    tagId: reminder.tagId,
    type: reminder.type,
    frequency: reminder.frequency,
    dayOfMonth: reminder.dayOfMonth,
    settings: reminder.settings as TagReminderSettingsApiResponse,
    isEnabled: reminder.isEnabled,
    lastCheckedAt: reminder.lastCheckedAt,
    lastTriggeredAt: reminder.lastTriggeredAt,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}

/**
 * Serialize multiple tag reminders
 */
export function serializeTagReminders(reminders: TagReminders[]): TagReminderApiResponse[] {
  return reminders.map(serializeTagReminder);
}
