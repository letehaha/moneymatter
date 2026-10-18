import { TAG_REMINDER_FREQUENCIES, TAG_REMINDER_TYPES } from '@bt/shared/types';
import { z } from 'zod';

/**
 * The tag reminder request fields, shared by the REST controllers and the MCP tools so both
 * paths accept exactly the same values.
 */
export const reminderTypeSchema = z.enum([TAG_REMINDER_TYPES.amountThreshold, TAG_REMINDER_TYPES.existenceCheck]);

/** `null` (or omitted) is a real-time reminder: it fires when a tagged transaction is saved. */
export const reminderFrequencySchema = z.enum([
  TAG_REMINDER_FREQUENCIES.daily,
  TAG_REMINDER_FREQUENCIES.weekly,
  TAG_REMINDER_FREQUENCIES.monthly,
  TAG_REMINDER_FREQUENCIES.quarterly,
  TAG_REMINDER_FREQUENCIES.yearly,
]);

export const reminderDayOfMonthSchema = z.number().int().min(1).max(31);

/** A decimal in the user's base currency, stored as sent. */
export const reminderAmountThresholdSchema = z.number().min(0.01);

const reminderSettingsSchema = z.object({
  amountThreshold: reminderAmountThresholdSchema.optional(),
});

export const createReminderBodySchema = z.object({
  type: reminderTypeSchema,
  frequency: reminderFrequencySchema.nullable().optional(),
  dayOfMonth: reminderDayOfMonthSchema.nullable().optional(),
  settings: reminderSettingsSchema.optional(),
  isEnabled: z.boolean().optional(),
});

export const updateReminderBodySchema = createReminderBodySchema.extend({
  type: reminderTypeSchema.optional(),
});
