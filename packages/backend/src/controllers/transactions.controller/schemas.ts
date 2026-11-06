import {
  MAX_PAYMENT_LEGS,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  isTwoLegTransfer,
} from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { z } from 'zod';

// Amount fields carry decimals (e.g. 100.50); callers convert them to cents after validation.

// Zero is allowed: a register entry can exist without ever moving money (a
// Microsoft Money voided cheque), and such rows must stay editable.
export const nonNegativeAmountSchema = () => z.number().nonnegative('Amount must be 0 or greater').finite();

// For amounts that carry no meaning at zero: a transfer leg that moves nothing,
// a fee that costs nothing, a split that holds no share of its parent.
export const positiveAmountSchema = () => z.number().positive('Amount must be greater than 0').finite();

// For amounts stored in a cents column that rejects zero: 0.004 passes `positive` but rounds to 0.
export const atLeastOneCentAmountSchema = () =>
  positiveAmountSchema().refine((amount) => Money.fromDecimal(amount).toCents() > 0, 'Amount must be at least 0.01');

// A year below 2000 is always a fat-fingered date ("26" for 2026): no ledger
// predates 2000, and such dates poison exchange-rate lookups.
const MIN_TRANSACTION_TIME = new Date('2000-01-01T00:00:00.000Z');

export const transactionTimeSchema = () =>
  z
    .string()
    .datetime({ message: 'Invalid ISO date string' })
    .refine((time) => new Date(time) >= MIN_TRANSACTION_TIME, {
      message: 'Transaction time cannot be before 2000-01-01',
    });

// A Payee link on a write: explicit `null` clears it, `undefined` leaves it untouched.
export const payeeIdSchema = () => recordId().nullable().optional();

const splitSchema = z.object({
  categoryId: recordId(),
  amount: positiveAmountSchema(),
  note: z.string().max(100, 'Split note must not exceed 100 characters').nullish(),
});

const paymentLegSchema = z.union([
  z
    .object({
      transactionId: recordId(),
      amount: positiveAmountSchema().optional(),
      paymentAmount: positiveAmountSchema().optional(),
    })
    .strict(),
  z
    .object({
      accountId: recordId(),
      amount: positiveAmountSchema(),
      paymentAmount: positiveAmountSchema().optional(),
    })
    .strict(),
]);

const paymentLegsSchema = z.array(paymentLegSchema).max(MAX_PAYMENT_LEGS);

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const transactionDetailFieldsSchema = {
  externalUrl: z
    .string()
    .max(2048, 'The URL must not exceed 2048 characters.')
    .url('Invalid URL')
    .regex(/^https?:\/\//i, 'Only http(s) URLs are allowed')
    .nullish(),
  externalReference: z.string().max(255, 'The reference must not exceed 255 characters.').nullish(),
  location: locationSchema.nullish(),
};

export const createTransactionBodyShape = {
  amount: nonNegativeAmountSchema(),
  commissionRate: positiveAmountSchema().optional(),
  note: z.string().max(1000, 'The string must not exceed 1000 characters.').nullish(),
  ...transactionDetailFieldsSchema,
  time: transactionTimeSchema().optional(),
  transactionType: z.nativeEnum(TRANSACTION_TYPES),
  paymentType: z.nativeEnum(PAYMENT_TYPES).optional(),
  accountId: recordId(),
  destinationAmount: positiveAmountSchema().optional(),
  destinationAccountId: recordId().optional(),
  destinationTransactionId: recordId().optional(),
  categoryId: z.union([recordId(), z.undefined()]),
  transferNature: z.nativeEnum(TRANSACTION_TRANSFER_NATURE),
  refundForTxId: recordId().optional(),
  refundForSplitId: recordId().optional(),
  refundForAmount: atLeastOneCentAmountSchema().optional(),
  splits: z.array(splitSchema).max(10, 'Maximum 10 splits allowed').optional(),
  tagIds: z.array(recordId()).max(20, 'Maximum 20 tags allowed').optional(),
  payeeId: payeeIdSchema(),
  payeeLocked: z.boolean().optional(),
  isPlanned: z.boolean().optional().default(false),
  applyAutomations: z.boolean().optional().default(false),
  originalAmount: nonNegativeAmountSchema().optional(),
  originalCurrencyCode: currencyCode().optional(),
  paymentLegs: paymentLegsSchema.optional(),
};

export const createTransactionBodySchema = z
  .object(createTransactionBodyShape)
  .refine(
    (data) =>
      !(data.transferNature && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer && data.refundForTxId),
    {
      message: `Non-${TRANSACTION_TRANSFER_NATURE.not_transfer} cannot be used in "transferNature" when "refundForTxId" is used`,
      path: ['transferNature', 'refundForTxId'],
    },
  )
  .refine((data) => !(data.refundForSplitId && !data.refundForTxId), {
    message: '"refundForSplitId" can only be provided when "refundForTxId" is specified',
    path: ['refundForSplitId', 'refundForTxId'],
  })
  .refine((data) => !(data.refundForAmount !== undefined && !data.refundForTxId), {
    message: '"refundForAmount" can only be provided when "refundForTxId" is specified',
    path: ['refundForAmount', 'refundForTxId'],
  })
  .refine(
    (data) => {
      if (data.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) {
        return !(data.accountId && data.destinationAccountId);
      }
      return true;
    },
    {
      message: `"accountId" and "destinationAccountId" cannot be used both when "${TRANSACTION_TRANSFER_NATURE.transfer_out_wallet}" is provided`,
      path: ['accountId', 'destinationAccountId'],
    },
  )
  .refine(
    // Loan payments only link via destinationAccountId, never destinationTransactionId.
    (data) => !(data.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan && data.destinationTransactionId),
    {
      message: `"${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}" cannot be combined with "destinationTransactionId" - loan payments are created via "destinationAccountId" only`,
      path: ['transferNature', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (isTwoLegTransfer(data.transferNature) && data.destinationTransactionId) {
        return !(data.destinationAccountId || data.destinationAmount);
      }
      return true;
    },
    {
      message: `When "destinationTransactionId" is provided for a two-leg transfer (${TRANSACTION_TRANSFER_NATURE.common_transfer} / ${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}), other fields should not be present`,
      path: ['destinationAccountId', 'destinationAmount', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (isTwoLegTransfer(data.transferNature) && !data.destinationTransactionId) {
        return !!(data.destinationAccountId && data.destinationAmount);
      }
      return true;
    },
    {
      message: `For two-leg transfers (${TRANSACTION_TRANSFER_NATURE.common_transfer} / ${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}) without "destinationTransactionId" - "destinationAccountId" and "destinationAmount" must be provided`,
      path: ['destinationAccountId', 'destinationAmount', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (data.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer && data.categoryId === undefined) {
        return false;
      }
      return true;
    },
    {
      message: "'categoryId' is required for non-transfer transactions.",
      path: ['categoryId', 'transferNature'],
    },
  )
  .refine(
    (data) => {
      if (typeof data.commissionRate === 'number' && data.amount < data.commissionRate) {
        return false;
      }
      return true;
    },
    {
      message: "'commissionRate' cannot be greater than 'amount",
      path: ['commissionRate', 'amount'],
    },
  )
  .refine(
    (data) => {
      // Splits are not allowed on transfer transactions
      if (data.splits && data.splits.length > 0 && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
        return false;
      }
      return true;
    },
    {
      message: 'Splits cannot be added to transfer transactions',
      path: ['splits', 'transferNature'],
    },
  )
  .refine((data) => (data.originalAmount === undefined) === (data.originalCurrencyCode === undefined), {
    message: '"originalAmount" and "originalCurrencyCode" must be provided together',
    path: ['originalAmount', 'originalCurrencyCode'],
  })
  .refine(
    (data) => !(data.originalAmount !== undefined && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer),
    {
      message: 'Original currency metadata cannot be added to transfer transactions',
      path: ['originalAmount', 'transferNature'],
    },
  );

export const updateTransactionBodyShape = {
  amount: nonNegativeAmountSchema().optional(),
  destinationAmount: positiveAmountSchema().optional(),
  note: z.string().max(1000, 'The string must not exceed 1000 characters.').nullish(),
  ...transactionDetailFieldsSchema,
  time: transactionTimeSchema().optional(),
  transactionType: z.nativeEnum(TRANSACTION_TYPES).optional(),
  paymentType: z.nativeEnum(PAYMENT_TYPES).optional(),
  accountId: recordId().optional(),
  destinationAccountId: recordId().optional(),
  destinationTransactionId: recordId().optional(),
  categoryId: recordId().optional(),
  transferNature: z.nativeEnum(TRANSACTION_TRANSFER_NATURE).optional(),
  refundedByTxIds: z
    .array(z.union([recordId(), z.object({ txId: recordId(), amount: atLeastOneCentAmountSchema().nullish() })]))
    .nullish(),
  refundsTxId: recordId().nullish(),
  refundsSplitId: recordId().nullish(),
  refundsTargets: z
    .array(
      z.object({
        txId: recordId(),
        splitId: recordId().nullish(),
        amount: atLeastOneCentAmountSchema().nullish(),
      }),
    )
    .min(1)
    .nullish(),
  splits: z.array(splitSchema).max(10, 'Maximum 10 splits allowed').nullish(),
  tagIds: z.array(recordId()).max(20, 'Maximum 20 tags allowed').nullish(),
  payeeId: payeeIdSchema(),
  payeeLocked: z.boolean().optional(),
  isPlanned: z.boolean().optional(),
  originalAmount: nonNegativeAmountSchema().nullable().optional(),
  originalCurrencyCode: currencyCode().nullable().optional(),
  paymentLegs: paymentLegsSchema.nullish(),
};

export const updateTransactionBodySchema = z
  .object(updateTransactionBodyShape)
  .refine((data) => !(data.refundsSplitId && !data.refundsTxId), {
    message: '"refundsSplitId" can only be provided when "refundsTxId" is specified',
    path: ['refundsSplitId', 'refundsTxId'],
  })
  .refine(
    (data) =>
      [data.refundedByTxIds, data.refundsTxId, data.refundsTargets].filter((field) => field !== undefined).length <= 1,
    { message: "Only one of 'refundedByTxIds', 'refundsTxId' and 'refundsTargets' can be provided" },
  )
  .refine(
    (data) =>
      !data.refundsTargets ||
      new Set(data.refundsTargets.map((target) => target.txId)).size === data.refundsTargets.length,
    {
      message: "Each transaction can appear only once in 'refundsTargets'",
      path: ['refundsTargets'],
    },
  )
  .refine(
    (data) =>
      !data.refundedByTxIds ||
      new Set(data.refundedByTxIds.map((item) => (typeof item === 'string' ? item : item.txId))).size ===
        data.refundedByTxIds.length,
    {
      message: "Each transaction can appear only once in 'refundedByTxIds'",
      path: ['refundedByTxIds'],
    },
  )
  .refine(
    // Loan payments only link via destinationAccountId, never destinationTransactionId.
    (data) => !(data.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan && data.destinationTransactionId),
    {
      message: `"${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}" cannot be combined with "destinationTransactionId" - loan payments are created via "destinationAccountId" only`,
      path: ['transferNature', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (isTwoLegTransfer(data.transferNature) && data.destinationTransactionId) {
        return !(data.destinationAccountId || data.destinationAmount);
      }
      return true;
    },
    {
      message: `When "destinationTransactionId" is provided for a two-leg transfer (${TRANSACTION_TRANSFER_NATURE.common_transfer} / ${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}), other fields should not be present`,
      path: ['destinationAccountId', 'destinationAmount', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (isTwoLegTransfer(data.transferNature) && !data.destinationTransactionId) {
        return !!(data.destinationAccountId && data.destinationAmount);
      }
      return true;
    },
    {
      message: `For two-leg transfers (${TRANSACTION_TRANSFER_NATURE.common_transfer} / ${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}) without "destinationTransactionId" - "destinationAccountId" and "destinationAmount" must be provided`,
      path: ['destinationAccountId', 'destinationAmount', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      // Splits are not allowed on transfer transactions
      if (data.splits && data.splits.length > 0) {
        // Explicit transfer via transferNature
        if (data.transferNature && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
          return false;
        }
        // Implicit transfer via destination fields
        if (data.destinationAccountId || data.destinationAmount || data.destinationTransactionId) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Splits cannot be added to transfer transactions',
      path: ['splits', 'transferNature'],
    },
  )
  .refine(
    (data) =>
      (data.originalAmount === undefined) === (data.originalCurrencyCode === undefined) &&
      (data.originalAmount === null) === (data.originalCurrencyCode === null),
    {
      message: '"originalAmount" and "originalCurrencyCode" must be set, or cleared, together',
      path: ['originalAmount', 'originalCurrencyCode'],
    },
  )
  .refine(
    (data) => {
      if (data.originalAmount == null) return true;
      if (data.transferNature && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) return false;
      return !(data.destinationAccountId || data.destinationAmount || data.destinationTransactionId);
    },
    {
      message: 'Original currency metadata cannot be added to transfer transactions',
      path: ['originalAmount', 'transferNature'],
    },
  );
