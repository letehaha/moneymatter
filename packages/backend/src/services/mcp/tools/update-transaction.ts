import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import {
  nonNegativeAmountSchema,
  payeeIdSchema,
  positiveAmountSchema,
  transactionDetailFieldsSchema,
} from '@controllers/transactions.controller/schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactionTuple } from '@root/serializers/transactions.serializer';
import { updateTransaction } from '@services/transactions/update-transaction';
import { z } from 'zod';

import {
  assertBaseCurrencyUnlocked,
  assertOriginalCurrencyArgs,
  getUserId,
  jsonContent,
  requireScope,
  type ToolArgs,
} from './helpers';

const inputSchema = {
  id: recordId().describe('ID of the transaction to update'),
  accountId: recordId().optional().describe('Move transaction to a different account'),
  amount: nonNegativeAmountSchema()
    .optional()
    .describe('New amount as an unsigned decimal (e.g. 12.50). Never negative: transactionType sets the direction'),
  transactionType: z
    .enum([TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense])
    .optional()
    .describe('Change whether this is income or expense'),
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
    .describe('Payment method used'),
  transferNature: z
    .enum([
      TRANSACTION_TRANSFER_NATURE.not_transfer,
      TRANSACTION_TRANSFER_NATURE.common_transfer,
      TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    ])
    .optional()
    .describe('Transfer type'),
  categoryId: recordId().optional().describe('New category ID'),
  time: z.string().optional().describe('New date/time as ISO 8601 string'),
  note: z.string().optional().nullable().describe('New note. Pass null to clear'),
  destinationAccountId: recordId().optional().describe('For transfers: new destination account ID'),
  destinationAmount: positiveAmountSchema()
    .optional()
    .describe('For transfers: new amount received in destination account (decimal, greater than 0)'),
  destinationTransactionId: z
    .string()
    .uuid()
    .optional()
    .describe('For transfers: link to an existing destination transaction'),
  splits: z
    .array(
      z.object({
        categoryId: recordId().describe('Category ID for this split portion'),
        amount: positiveAmountSchema().describe('Amount for this split portion (decimal, greater than 0)'),
        note: z.string().optional().nullable().describe('Optional note for this split'),
      }),
    )
    .nullable()
    .optional()
    .describe('Replace splits. Pass null or empty array to clear all splits'),
  tagIds: z
    .array(recordId())
    .nullable()
    .optional()
    .describe('Replace tags. Pass null or empty array to clear all tags'),
  payeeId: payeeIdSchema().describe('ID of an existing payee to link (from get_payees). Pass null to clear the payee'),
  originalAmount: z
    .number()
    .nonnegative()
    .finite()
    .nullable()
    .optional()
    .describe(
      'Amount in the currency the purchase was originally priced in (decimal), e.g. 66.42 for a PLN invoice paid from a UAH account. Informational only: never affects balances. Requires originalCurrencyCode. Pass null on both to clear',
    ),
  originalCurrencyCode: currencyCode()
    .nullable()
    .optional()
    .describe(
      'ISO 4217 code of originalAmount (e.g. "PLN"). Requires originalAmount. Cannot be combined with transfer fields',
    ),
  externalUrl: transactionDetailFieldsSchema.externalUrl.describe(
    'http(s) link to the source document (max 2048 characters). Pass null to clear',
  ),
  externalReference: transactionDetailFieldsSchema.externalReference.describe(
    'External reference such as an invoice number (max 255 characters). Pass null to clear',
  ),
  location: transactionDetailFieldsSchema.location.describe('{ latitude, longitude } in degrees. Pass null to clear'),
  payeeLocked: z.boolean().optional().describe('true pins the payee so automations and bank sync never change it'),
  isPlanned: z
    .boolean()
    .optional()
    .describe('true marks it planned, false marks it as happened (see also confirm_planned_transaction)'),
};

/** The original-currency pair rule, which the plain input shape cannot hold. */
export function validateUpdateTransactionArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  assertOriginalCurrencyArgs({ args });
}

export function registerUpdateTransaction(server: McpServer) {
  server.registerTool(
    'update_transaction',
    {
      description:
        'Update an existing transaction by ID. All fields except id are optional — only provide what you want to change. Pass tagIds: null to clear all tags, or tagIds: [] to do the same. Pass splits: null to clear all splits. Use payeeId to link an existing payee, or payeeId: null to clear it. Use originalAmount + originalCurrencyCode to record what the purchase cost in its invoice currency when that differs from the account currency.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_transaction', clientId: extra.authInfo?.clientId });

      validateUpdateTransactionArgs({ args });

      const result = await updateTransaction({
        id: args.id,
        userId,
        accountId: args.accountId,
        amount: args.amount !== undefined ? Money.fromDecimal(args.amount) : undefined,
        transactionType: args.transactionType,
        paymentType: args.paymentType,
        transferNature: args.transferNature,
        categoryId: args.categoryId,
        time: args.time ? new Date(args.time) : undefined,
        note: args.note,
        destinationAccountId: args.destinationAccountId,
        destinationAmount: args.destinationAmount !== undefined ? Money.fromDecimal(args.destinationAmount) : undefined,
        destinationTransactionId: args.destinationTransactionId,
        splits:
          args.splits === null
            ? null
            : args.splits?.map((s) => ({
                categoryId: s.categoryId,
                amount: Money.fromDecimal(s.amount),
                note: s.note,
              })),
        tagIds: args.tagIds,
        originalAmount: args.originalAmount != null ? Money.fromDecimal(args.originalAmount) : args.originalAmount,
        originalCurrencyCode: args.originalCurrencyCode,
        externalUrl: args.externalUrl,
        externalReference: args.externalReference,
        location: args.location,
        payeeLocked: args.payeeLocked,
        isPlanned: args.isPlanned,
        // null clears the link, so only an omitted payeeId is left out
        ...(args.payeeId !== undefined ? { payeeId: args.payeeId } : {}),
      });

      return jsonContent({ data: serializeTransactionTuple(result) });
    },
  );
}
