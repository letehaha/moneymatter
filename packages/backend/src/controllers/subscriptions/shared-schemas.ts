import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

export const matchingRuleSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('note'),
    operator: z.literal('contains_any'),
    value: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    field: z.literal('amount'),
    operator: z.literal('between'),
    value: z.object({ min: z.number().nonnegative().finite(), max: z.number().nonnegative().finite() }),
    currencyCode: currencyCode().optional(),
  }),
  z.object({
    field: z.literal('transactionType'),
    operator: z.literal('equals'),
    value: z.string(),
  }),
  z.object({
    field: z.literal('accountId'),
    operator: z.literal('equals'),
    value: recordId(),
  }),
]);

/** Body of accepting a detected candidate: the REST controller and the MCP tool share it. */
export const acceptCandidateBodySchema = z.object({
  /** Attach the candidate's sample transactions to this existing subscription. */
  subscriptionId: recordId().optional(),
});

/** Query of the period list: the REST controller and the MCP tool share it. */
export const getPeriodsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

/** Body of paying a period: the REST controller and the MCP tool share it. */
export const markPeriodPaidBodySchema = z
  .object({
    transactionId: recordId().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    // Create the expense transaction from the subscription instead of linking
    // an existing one. Mutually exclusive with `transactionId`.
    createTransaction: z.boolean().optional(),
    // Decimal amount override for the created transaction. Falls back to the
    // subscription's expectedAmount when omitted.
    amount: z.number().positive().optional(),
    // Actual payment date for the created transaction. Falls back to now when omitted.
    time: z.coerce.date().optional(),
    // Account to book the created transaction against. When supplied it is also
    // linked to the subscription so future payments reuse it. Used by the
    // pay-time "create a transaction" flow for account-less subscriptions.
    accountId: recordId().nullable().optional(),
  })
  // Create-mode and link-mode can't be combined: the user either links an
  // existing transaction or creates a new one, never both.
  .refine((b) => !(b.createTransaction && b.transactionId != null), {
    message: 'createTransaction and transactionId cannot be used together',
    path: ['transactionId'],
  });
