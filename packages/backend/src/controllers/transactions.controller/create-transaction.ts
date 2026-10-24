import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, isTwoLegTransfer } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deserializeCreateTransaction, serializeTransactionTuple } from '@root/serializers';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import {
  nonNegativeAmountSchema,
  payeeIdSchema,
  positiveAmountSchema,
  splitSchema,
  transactionDetailFieldsSchema,
  transactionTimeSchema,
} from './schemas';

const schema = z.object({
  body: z
    .object({
      amount: nonNegativeAmountSchema(),
      commissionRate: positiveAmountSchema().optional(),
      note: z.string().max(1000, 'The string must not exceed 1000 characters.').nullish(),
      ...transactionDetailFieldsSchema,
      time: transactionTimeSchema().optional(),
      transactionType: z.nativeEnum(TRANSACTION_TYPES),
      paymentType: z.nativeEnum(PAYMENT_TYPES),
      accountId: recordId(),
      destinationAmount: positiveAmountSchema().optional(),
      destinationAccountId: recordId().optional(),
      destinationTransactionId: recordId().optional(),
      categoryId: z.union([recordId(), z.undefined()]),
      transferNature: z.nativeEnum(TRANSACTION_TRANSFER_NATURE),
      refundForTxId: recordId().optional(),
      refundForSplitId: recordId().optional(),
      splits: z.array(splitSchema).max(10, 'Maximum 10 splits allowed').optional(),
      tagIds: z.array(recordId()).max(20, 'Maximum 20 tags allowed').optional(),
      payeeId: payeeIdSchema(),
      payeeLocked: z.boolean().optional(),
      isPlanned: z.boolean().optional().default(false),
      applyAutomations: z.boolean().optional().default(false),
      originalAmount: nonNegativeAmountSchema().optional(),
      originalCurrencyCode: currencyCode().optional(),
    })
    .refine(
      (data) =>
        !(
          data.transferNature &&
          data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer &&
          data.refundForTxId
        ),
      {
        message: `Non-${TRANSACTION_TRANSFER_NATURE.not_transfer} cannot be used in "transferNature" when "refundForTxId" is used`,
        path: ['transferNature', 'refundForTxId'],
      },
    )
    .refine((data) => !(data.refundForSplitId && !data.refundForTxId), {
      message: '"refundForSplitId" can only be provided when "refundForTxId" is specified',
      path: ['refundForSplitId', 'refundForTxId'],
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
      (data) =>
        !(data.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan && data.destinationTransactionId),
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
      (data) =>
        !(data.originalAmount !== undefined && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer),
      {
        message: 'Original currency metadata cannot be added to transfer transactions',
        path: ['originalAmount', 'transferNature'],
      },
    ),
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;

  // Deserialize: convert decimal amounts to cents
  const params = deserializeCreateTransaction(body, userId);

  // TODO: Add validations
  // 1. Amount and destinationAmount with same currency should be equal

  const transactions = await transactionsService.createTransaction(params);

  // Serialize: convert cents to decimal for API response
  // createTransaction returns [baseTx, oppositeTx?] tuple
  return { data: serializeTransactionTuple(transactions) };
});
