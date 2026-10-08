import type { RecordId } from './record-id';

/**
 * Tag reminder trigger types
 */
export const TAG_REMINDER_TYPES = {
  amountThreshold: 'amount_threshold',
  existenceCheck: 'existence_check',
} as const;

export type TagReminderType = (typeof TAG_REMINDER_TYPES)[keyof typeof TAG_REMINDER_TYPES];

/**
 * Tag reminder frequency presets
 */
export const TAG_REMINDER_FREQUENCIES = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'yearly',
} as const;

export type TagReminderFrequency = (typeof TAG_REMINDER_FREQUENCIES)[keyof typeof TAG_REMINDER_FREQUENCIES];

/**
 * Special value for real-time/immediate reminders (no scheduled frequency).
 * Used in frontend forms to represent `null` frequency.
 */
export const TAG_REMINDER_IMMEDIATE = 'immediate' as const;

export type TagReminderFrequencyOrImmediate = TagReminderFrequency | typeof TAG_REMINDER_IMMEDIATE;

export interface TagModel {
  id: RecordId;
  userId: number;
  name: string;
  color: string;
  icon: string | null;
  description: string | null;
  createdAt: Date;
  /** Count of reminders associated with this tag (populated on list fetch) */
  remindersCount?: number;
}

/**
 * Type-specific settings for amount threshold reminders
 */
export interface AmountThresholdSettings {
  /** Threshold amount in cents */
  amountThreshold: number;
}

export type TagReminderSettings = AmountThresholdSettings | Record<string, unknown>;

export interface TagReminderModel {
  id: RecordId;
  userId: number;
  tagId: RecordId;
  type: TagReminderType;
  /** Frequency preset. Null means real-time trigger (immediate when tagged) */
  frequency: TagReminderFrequency | null;
  /** Day of month to check (1-31). Only used for monthly/quarterly/yearly. Null = 1st */
  dayOfMonth: number | null;
  /** Type-specific settings (e.g., amountThreshold for amount_threshold type) */
  settings: TagReminderSettings;
  isEnabled: boolean;
  lastCheckedAt: Date | null;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
