import { MAX_REMIND_BEFORE_PRESETS, REMIND_BEFORE_PRESETS, type RemindBeforePreset } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { matchingRulesSchema } from '@controllers/subscriptions/shared-schemas';
import { z } from 'zod';

const MATCHING_RULES_DESCRIPTION = [
  'Rules that auto-link imported or new transactions to this subscription: { rules: [...] }. { "rules": [] } turns auto-matching off (link by hand). A transaction is linked when EVERY rule passes (AND), the subscription is active, its transactionType matches and, if it has an accountId, the account matches. Rules also drive the 12-month historical suggestions. They cannot be combined with autoRecord=true.',
  'Rule shapes:',
  '- { "field": "note", "operator": "contains_any", "value": ["netflix", "nflx"] }: the note contains any keyword (case-insensitive), 1+ non-empty keywords.',
  '- { "field": "amount", "operator": "between", "value": { "min": 9, "max": 11 }, "currencyCode": "USD" }: absolute amount within the decimal bounds, inclusive. Without currencyCode amounts are compared in each transaction currency; with it other currencies are converted first and get 5% tolerance.',
  '- { "field": "transactionType", "operator": "equals", "value": "expense" | "income" }',
  '- { "field": "accountId", "operator": "equals", "value": "<account uuid>" }',
].join('\n');

export const subscriptionMatchingRulesInput = matchingRulesSchema.optional().describe(MATCHING_RULES_DESCRIPTION);

export const subscriptionMatchingRulesUpdateInput = matchingRulesSchema
  .optional()
  .describe(`Replaces ALL matching rules (send the full list; omit to keep them).\n${MATCHING_RULES_DESCRIPTION}`);

const remindBeforePresets = Object.values(REMIND_BEFORE_PRESETS) as [RemindBeforePreset, ...RemindBeforePreset[]];

/** Fields create_subscription and update_subscription share beyond the core schedule: payee, tags, reminders, auto-record. */
export const subscriptionExtraInputs = {
  payeeId: recordId()
    .nullable()
    .optional()
    .describe(
      'Payee ID (from get_payees) stamped onto matched or booked transactions that have no payee. Null clears it.',
    ),
  tagIds: z
    .array(recordId())
    .optional()
    .describe(
      'Tag IDs (from get_tags) added to matched or booked transactions. On update replaces the whole set; [] clears it.',
    ),
  remindBefore: z
    .array(z.enum(remindBeforePresets))
    .max(MAX_REMIND_BEFORE_PRESETS)
    .optional()
    .describe(
      `Reminder offsets before each due date ("0_days" = on the day), up to ${MAX_REMIND_BEFORE_PRESETS}. Needs a dueDate. On update replaces the list.`,
    ),
  notifyEmail: z.boolean().optional().describe('Also email the reminders (in-app ones are always sent)'),
  autoRecord: z
    .boolean()
    .optional()
    .describe(
      'Book the payment automatically on each due date. Needs a manual (not bank-connected) accountId, expectedAmount + expectedCurrencyCode and a dueDate; matchingRules must be empty.',
    ),
};
