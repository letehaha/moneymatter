/**
 * TagReminders Serializers
 *
 * Maps reminders between the API and the model. `settings.amountThreshold` lives in a JSON
 * column (not a @MoneyField column) and is stored as the same decimal the API speaks, in the
 * user's base currency, so the settings pass through unchanged.
 */
import { type TagReminderFrequency, type TagReminderType } from '@bt/shared/types';
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
// Request Types (API format with decimal input)
// ============================================================================

interface CreateTagReminderRequest {
  type: TagReminderType;
  frequency?: TagReminderFrequency | null;
  dayOfMonth?: number | null;
  settings?: {
    amountThreshold?: number; // decimal from API
    [key: string]: unknown;
  };
  isEnabled?: boolean;
}

interface UpdateTagReminderRequest {
  type?: TagReminderType;
  frequency?: TagReminderFrequency | null;
  dayOfMonth?: number | null;
  settings?: {
    amountThreshold?: number; // decimal from API
    [key: string]: unknown;
  };
  isEnabled?: boolean;
}

// ============================================================================
// Internal Types (DB format)
// ============================================================================

interface TagReminderSettingsInternal {
  amountThreshold?: number; // decimal in the user's base currency
  [key: string]: unknown;
}

interface CreateTagReminderInternal {
  type: TagReminderType;
  frequency?: TagReminderFrequency | null;
  dayOfMonth?: number | null;
  settings?: TagReminderSettingsInternal;
  isEnabled?: boolean;
}

interface UpdateTagReminderInternal {
  type?: TagReminderType;
  frequency?: TagReminderFrequency | null;
  dayOfMonth?: number | null;
  settings?: TagReminderSettingsInternal;
  isEnabled?: boolean;
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

// ============================================================================
// Deserializers (API → DB)
// ============================================================================

/**
 * Deserialize a create tag reminder request from API format to the internal format
 */
export function deserializeCreateTagReminder(req: CreateTagReminderRequest): CreateTagReminderInternal {
  return {
    type: req.type,
    frequency: req.frequency,
    dayOfMonth: req.dayOfMonth,
    settings: req.settings,
    isEnabled: req.isEnabled,
  };
}

/**
 * Deserialize an update tag reminder request from API format to the internal format
 */
export function deserializeUpdateTagReminder(req: UpdateTagReminderRequest): UpdateTagReminderInternal {
  return {
    type: req.type,
    frequency: req.frequency,
    dayOfMonth: req.dayOfMonth,
    settings: req.settings,
    isEnabled: req.isEnabled,
  };
}
