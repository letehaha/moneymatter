import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import {
  nonNegativeAmountSchema,
  paymentLegsSchema,
  positiveAmountSchema,
} from '@controllers/transactions.controller/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deserializeCreateTransaction, serializeTransactionTuple } from '@root/serializers';
import { createTransaction } from '@services/transactions/create-transaction';
import { z } from 'zod';

import {
  assertBaseCurrencyUnlocked,
  assertOriginalCurrencyArgs,
  getUserId,
  jsonContent,
  requireScope,
} from './helpers';

const inputSchema = {
  accountId: recordId().describe('ID of the account the transaction belongs to'),
  amount: nonNegativeAmountSchema().describe(
    'Transaction amount as an unsigned decimal (e.g. 12.50). Never negative: transactionType sets the direction',
  ),
  transactionType: z
    .enum([TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense])
    .describe('Whether this is income or expense'),
  paymentType: z
    .enum([
      PAYMENT_TYPES.bankTransfer,
      PAYMENT_TYPES.cash,
      PAYMENT_TYPES.creditCard,
      PAYMENT_TYPES.debitCard,
      PAYMENT_TYPES.mobilePayment,
      PAYMENT_TYPES.voucher,
      PAYMENT_TYPES.webPayment,
    ])
    .optional()
    .describe("Payment method used. Defaults to the account's default payment type, or bankTransfer"),
  transferNature: z
    .enum([
      TRANSACTION_TRANSFER_NATURE.not_transfer,
      TRANSACTION_TRANSFER_NATURE.common_transfer,
      TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    ])
    .describe('Transfer type. Use not_transfer for regular income/expense'),
  categoryId: recordId().optional().describe('Category ID to assign to this transaction'),
  time: z.string().optional().describe('Transaction date/time as ISO 8601 string. Defaults to now'),
  note: z.string().max(1000).optional().describe('Optional note or description for the transaction'),
  destinationAccountId: recordId().optional().describe('For transfers: destination account ID'),
  destinationAmount: positiveAmountSchema()
    .optional()
    .describe('For transfers: amount received in destination account (decimal, greater than 0)'),
  destinationTransactionId: z
    .string()
    .uuid()
    .optional()
    .describe('For transfers: link to an existing destination transaction instead of creating one'),
  splits: z
    .array(
      z.object({
        categoryId: recordId().describe('Category ID for this split portion'),
        amount: positiveAmountSchema().describe('Amount for this split portion (decimal, greater than 0)'),
        note: z.string().max(100).optional().nullable().describe('Optional note for this split'),
      }),
    )
    .optional()
    .describe('Split the transaction across multiple categories'),
  tagIds: z.array(recordId()).optional().describe('Tag IDs to assign to this transaction'),
  payeeId: recordId().optional().describe('Payee ID to assign'),
  isPlanned: z.boolean().optional().describe('Mark the transaction as planned rather than an already-happened record'),
  originalAmount: z
    .number()
    .nonnegative()
    .finite()
    .optional()
    .describe(
      'Amount in the currency the purchase was originally priced in (decimal), e.g. 66.42 for a PLN invoice paid from a UAH account. Informational only: never affects balances. Requires originalCurrencyCode',
    ),
  originalCurrencyCode: currencyCode()
    .optional()
    .describe(
      'ISO 4217 code of originalAmount (e.g. "PLN"). Requires originalAmount. Cannot be combined with transfer fields',
    ),
  paymentLegs: paymentLegsSchema
    .optional()
    .describe(
      "Pay this income/expense from up to 4 more accounts. Each item is either { accountId, amount } to create a part on another account, or { transactionId } to link an existing transaction as a part (its amount stays). amount is in that account's currency; when it differs from this transaction's currency also pass paymentAmount, the part's value in this transaction's currency. Not allowed for transfers, refunds, planned or category-split transactions",
    ),
};

export function registerCreateTransaction(server: McpServer) {
  server.registerTool(
    'create_transaction',
    {
      description:
        'Create a new transaction (income, expense, or transfer). Requires accountId, amount (decimal), transactionType, and transferNature. paymentType is optional and defaults to the default payment type of the account. For transfers, also provide destinationAccountId and destinationAmount. Use splits to categorize portions of the amount. Use originalAmount + originalCurrencyCode to record what the purchase cost in its invoice currency when that differs from the account currency. Use paymentLegs to pay one purchase from several accounts.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_transaction', clientId: extra.authInfo?.clientId });

      assertOriginalCurrencyArgs({ args });

      const params = deserializeCreateTransaction(
        {
          amount: args.amount,
          note: args.note,
          time: args.time,
          transactionType: args.transactionType,
          paymentType: args.paymentType,
          accountId: args.accountId,
          destinationAmount: args.destinationAmount,
          destinationAccountId: args.destinationAccountId,
          destinationTransactionId: args.destinationTransactionId,
          categoryId: args.categoryId,
          transferNature: args.transferNature,
          splits: args.splits,
          tagIds: args.tagIds,
          payeeId: args.payeeId,
          isPlanned: args.isPlanned,
          originalAmount: args.originalAmount,
          originalCurrencyCode: args.originalCurrencyCode,
          paymentLegs: args.paymentLegs,
        },
        userId,
      );

      const result = await createTransaction(params);
      return jsonContent({ data: serializeTransactionTuple(result) });
    },
  );
}
