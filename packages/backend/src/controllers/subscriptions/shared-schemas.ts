import {
  MAX_REMIND_BEFORE_PRESETS,
  REMIND_BEFORE_PRESETS,
  RemindBeforePreset,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { currencyCode, dateBound, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { t } from '@i18n/index';
import { z } from 'zod';

const matchingRuleSchema = z.discriminatedUnion('field', [
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

/** A subscription's matching rules: the REST controllers and the MCP tools share it. */
export const matchingRulesSchema = z.object({ rules: z.array(matchingRuleSchema) });

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

const remindBeforePresetValues = Object.values(REMIND_BEFORE_PRESETS) as [RemindBeforePreset, ...RemindBeforePreset[]];

export const createSubscriptionBodyShape = {
  name: z.string().min(1).max(200).trim(),
  type: z
    .enum(Object.values(SUBSCRIPTION_TYPES) as [SUBSCRIPTION_TYPES, ...SUBSCRIPTION_TYPES[]])
    .optional()
    .default(SUBSCRIPTION_TYPES.subscription),
  transactionType: z
    .enum(Object.values(TRANSACTION_TYPES) as [TRANSACTION_TYPES, ...TRANSACTION_TYPES[]])
    .optional()
    .default(TRANSACTION_TYPES.expense),
  // Decimal amount (e.g. 9.99). Stored as cents internally by the service.
  expectedAmount: z.number().nonnegative().nullable().optional(),
  expectedCurrencyCode: currencyCode().nullable().optional(),
  frequency: z.enum(
    Object.values(SUBSCRIPTION_FREQUENCIES) as [SUBSCRIPTION_FREQUENCIES, ...SUBSCRIPTION_FREQUENCIES[]],
  ),
  startDate: dateBound(),
  endDate: dateBound().nullable().optional(),
  accountId: recordId().nullable().optional(),
  categoryId: recordId().nullable().optional(),
  payeeId: recordId().nullable().optional(),
  tagIds: z.array(recordId()).optional(),
  matchingRules: matchingRulesSchema.optional().default({ rules: [] }),
  notes: z.string().max(5000).nullable().optional(),
  dueDate: dateBound().nullable().optional(),
  maxOccurrences: z.number().int().positive().nullable().optional(),
  remindBefore: z.array(z.enum(remindBeforePresetValues)).max(MAX_REMIND_BEFORE_PRESETS).optional(),
  notifyEmail: z.boolean().optional(),
  autoRecord: z.boolean().optional(),
  // A key that sets a value stamps logoSource 'manual' on the new subscription;
  // absent keys leave the logo unset for the background resolver to fill in.
  ...logoFieldsShape,
};

export const createSubscriptionBodySchema = withDateOrder(
  z.object(createSubscriptionBodyShape).superRefine((data, ctx) => {
    refineLogoFields({ data, ctx });

    const hasAmount = data.expectedAmount != null;
    const hasCurrency = data.expectedCurrencyCode != null;

    if (hasAmount !== hasCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Both expectedAmount and expectedCurrencyCode must be provided together.',
        path: [hasAmount ? 'expectedCurrencyCode' : 'expectedAmount'],
      });
    }

    if (data.type === SUBSCRIPTION_TYPES.subscription && !hasAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Subscriptions require expectedAmount and expectedCurrencyCode.',
        path: ['expectedAmount'],
      });
    }

    // An installment is a finite plan: it needs a payment count and a schedule
    // to track progress against. Amount stays optional (supports variable plans).
    if (data.type === SUBSCRIPTION_TYPES.installment) {
      if (data.maxOccurrences == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Installments require maxOccurrences (the number of payments).',
          path: ['maxOccurrences'],
        });
      }
      if (data.dueDate == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Installments require a payment schedule date (dueDate).',
          path: ['dueDate'],
        });
      }
    }

    // Auto-record books a transaction every cycle, so it needs the booking
    // inputs and conflicts with matching rules (both would settle the same
    // period — auto-record on dueDate, matching on the next bank import).
    if (data.autoRecord) {
      if (data.accountId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t({ key: 'subscriptions.validation.autoRecord.requiresAccountField' }),
          path: ['accountId'],
        });
      }
      if (data.expectedAmount == null || data.expectedCurrencyCode == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t({ key: 'subscriptions.validation.autoRecord.requiresAmountField' }),
          path: ['expectedAmount'],
        });
      }
      if (data.matchingRules && data.matchingRules.rules.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t({ key: 'subscriptions.validation.autoRecord.excludesMatchingField' }),
          path: ['matchingRules'],
        });
      }
    }
  }),
  ['startDate', 'endDate'],
);

export const updateSubscriptionBodyShape = {
  name: z.string().min(1).max(200).trim().optional(),
  type: z.enum(Object.values(SUBSCRIPTION_TYPES) as [SUBSCRIPTION_TYPES, ...SUBSCRIPTION_TYPES[]]).optional(),
  // Decimal amount (e.g. 9.99). Stored as cents internally by the service.
  expectedAmount: z.number().nonnegative().nullable().optional(),
  expectedCurrencyCode: currencyCode().nullable().optional(),
  frequency: z
    .enum(Object.values(SUBSCRIPTION_FREQUENCIES) as [SUBSCRIPTION_FREQUENCIES, ...SUBSCRIPTION_FREQUENCIES[]])
    .optional(),
  startDate: dateBound().optional(),
  endDate: dateBound().nullable().optional(),
  accountId: recordId().nullable().optional(),
  categoryId: recordId().nullable().optional(),
  payeeId: recordId().nullable().optional(),
  tagIds: z.array(recordId()).optional(),
  matchingRules: matchingRulesSchema.optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
  dueDate: dateBound().nullable().optional(),
  maxOccurrences: z.number().int().positive().nullable().optional(),
  remindBefore: z.array(z.enum(remindBeforePresetValues)).max(MAX_REMIND_BEFORE_PRESETS).optional(),
  notifyEmail: z.boolean().optional(),
  autoRecord: z.boolean().optional(),
  // Absent key → no change; a key that changes the stored value stamps
  // logoSource 'manual'; a null that clears nothing writes nothing.
  ...logoFieldsShape,
};

export const updateSubscriptionBodySchema = withDateOrder(
  z.object(updateSubscriptionBodyShape).superRefine((data, ctx) => {
    refineLogoFields({ data, ctx });

    // When both are explicitly provided in the same update, they must be consistent
    const hasAmount = data.expectedAmount !== undefined ? data.expectedAmount != null : undefined;
    const hasCurrency = data.expectedCurrencyCode !== undefined ? data.expectedCurrencyCode != null : undefined;

    if (hasAmount !== undefined && hasCurrency !== undefined && hasAmount !== hasCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Both expectedAmount and expectedCurrencyCode must be provided together.',
        path: [hasAmount ? 'expectedCurrencyCode' : 'expectedAmount'],
      });
    }

    // When this update sets the type to installment, the count and schedule that
    // define the finite plan must travel in the same payload (the edit form sends
    // the full object). A partial payload that nulls either is caught by the DB
    // CHECK constraint instead.
    if (data.type === SUBSCRIPTION_TYPES.installment) {
      if (data.maxOccurrences == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Installments require maxOccurrences (the number of payments).',
          path: ['maxOccurrences'],
        });
      }
      if (data.dueDate == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Installments require a payment schedule date (dueDate).',
          path: ['dueDate'],
        });
      }
    }

    // When this update turns auto-record ON in the same payload, the booking
    // inputs must travel with it and matching rules (if also sent) must be
    // empty. A partial payload that flips only the toggle is caught by the
    // service-layer merge validation against the stored row.
    if (data.autoRecord === true) {
      if (data.accountId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t({ key: 'subscriptions.validation.autoRecord.requiresAccountField' }),
          path: ['accountId'],
        });
      }
      if (data.expectedAmount === null || data.expectedCurrencyCode === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t({ key: 'subscriptions.validation.autoRecord.requiresAmountField' }),
          path: ['expectedAmount'],
        });
      }
      if (data.matchingRules && data.matchingRules.rules.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t({ key: 'subscriptions.validation.autoRecord.excludesMatchingField' }),
          path: ['matchingRules'],
        });
      }
    }
  }),
  ['startDate', 'endDate'],
);
