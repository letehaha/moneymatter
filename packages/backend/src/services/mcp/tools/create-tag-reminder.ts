import { recordId } from '@common/lib/zod/custom-types';
import {
  reminderAmountThresholdSchema,
  reminderDayOfMonthSchema,
  reminderFrequencySchema,
  reminderTypeSchema,
} from '@controllers/tag-reminders/shared-schemas';
import { serializeTagReminder } from '@root/serializers';
import { createReminder } from '@services/tag-reminders';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const createTagReminderTool = defineTool({
  name: 'create_tag_reminder',
  toolset: 'automations',
  access: 'write',
  description:
    'Create a reminder on a tag. type amount_threshold needs amountThreshold (a decimal in the base currency) and notifies when the tag total in the period passes it; type existence_check notifies when the tag has no transaction in the period. Leave frequency out for a real-time reminder that fires when a tagged transaction is saved. A user can have 50 reminders, and an identical reminder on the same tag is refused as already existing. Returns the reminder.',
  input: {
    tagId: recordId().describe('Tag the reminder watches (from get_tags)'),
    type: reminderTypeSchema.describe(
      '"amount_threshold" notifies when the tag total in the period passes amountThreshold; "existence_check" notifies when the tag has no transaction in the period',
    ),
    frequency: reminderFrequencySchema
      .nullable()
      .optional()
      .describe('daily, weekly, monthly, quarterly or yearly. Omit or null for a real-time reminder'),
    dayOfMonth: reminderDayOfMonthSchema
      .nullable()
      .optional()
      .describe(
        'Day of the month, 1 to 31, for monthly, quarterly and yearly reminders. Shorter months use their last day',
      ),
    amountThreshold: reminderAmountThresholdSchema
      .optional()
      .describe(
        'Threshold above zero, a decimal in the base currency, rounded to its decimals. Required for amount_threshold',
      ),
    isEnabled: z.boolean().optional().describe('Default true'),
  },
  run: async ({ userId, args }) => {
    const reminder = await createReminder({
      userId,
      tagId: args.tagId,
      type: args.type,
      frequency: args.frequency ?? null,
      dayOfMonth: args.dayOfMonth ?? null,
      settings: args.amountThreshold === undefined ? {} : { amountThreshold: args.amountThreshold },
      isEnabled: args.isEnabled,
    });

    return serializeTagReminder(reminder);
  },
});
