import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import {
  updateTransactionBodySchema,
  updateTransactionBodyShape as shape,
} from '@controllers/transactions.controller/schemas';
import { deserializePaymentLegs, serializeTransactionTuple } from '@root/serializers/transactions.serializer';
import { updateTransaction } from '@services/transactions/update-transaction';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const updateTransactionTool = defineTool({
  name: 'update_transaction',
  toolset: 'core',
  access: 'write',
  description:
    'Update an existing transaction by ID. All fields except id are optional — only provide what you want to change. Pass tagIds: null to clear all tags, or tagIds: [] to do the same. Pass splits: null to clear all splits. Use payeeId to link an existing payee, or payeeId: null to clear it. Use originalAmount + originalCurrencyCode to record what the purchase cost in its invoice currency when that differs from the account currency. Use paymentLegs to change which accounts a multi-account payment is paid from.',
  input: {
    id: recordId().describe('ID of the transaction to update'),
    accountId: shape.accountId.describe('Move transaction to a different account'),
    amount: shape.amount.describe(
      'New amount as an unsigned decimal (e.g. 12.50). Never negative: transactionType sets the direction',
    ),
    transactionType: shape.transactionType.describe('Change whether this is income or expense'),
    paymentType: shape.paymentType.describe('Payment method used'),
    transferNature: z
      .enum([
        TRANSACTION_TRANSFER_NATURE.not_transfer,
        TRANSACTION_TRANSFER_NATURE.common_transfer,
        TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      ])
      .optional()
      .describe('Transfer type'),
    categoryId: shape.categoryId.describe('New category ID'),
    time: shape.time.describe('New date/time as ISO 8601 string'),
    note: shape.note.describe('New note. Pass null to clear'),
    destinationAccountId: shape.destinationAccountId.describe('For transfers: new destination account ID'),
    destinationAmount: shape.destinationAmount.describe(
      'For transfers: new amount received in destination account (decimal, greater than 0)',
    ),
    destinationTransactionId: shape.destinationTransactionId.describe(
      'For transfers: link to an existing destination transaction',
    ),
    splits: shape.splits.describe(
      'Replace splits. Pass null or empty array to clear all splits. Each item: { categoryId, amount (decimal, greater than 0), note (optional) }',
    ),
    tagIds: shape.tagIds.describe('Replace tags. Pass null or empty array to clear all tags'),
    payeeId: shape.payeeId.describe('ID of an existing payee to link (from get_payees). Pass null to clear the payee'),
    originalAmount: shape.originalAmount.describe(
      'Amount in the currency the purchase was originally priced in (decimal), e.g. 66.42 for a PLN invoice paid from a UAH account. Informational only: never affects balances. Requires originalCurrencyCode. Pass null on both to clear',
    ),
    originalCurrencyCode: shape.originalCurrencyCode.describe(
      'ISO 4217 code of originalAmount (e.g. "PLN"). Requires originalAmount. Cannot be combined with transfer fields',
    ),
    paymentLegs: shape.paymentLegs.describe(
      "Replace the payment's other accounts (same item shape as create_transaction). Keep a current part by passing its transactionId (see paymentParts in search_transactions), optionally with a new amount unless it is a linked part; an omitted created part is deleted, an omitted linked part becomes a standalone transaction again. Pass null or [] to make it a single-account transaction. Omit to leave the parts unchanged",
    ),
    externalUrl: shape.externalUrl.describe(
      'http(s) link to the source document (max 2048 characters). Pass null to clear',
    ),
    externalReference: shape.externalReference.describe(
      'External reference such as an invoice number (max 255 characters). Pass null to clear',
    ),
    location: shape.location.describe('{ latitude, longitude } in degrees. Pass null to clear'),
    payeeLocked: shape.payeeLocked.describe('true pins the payee so automations and bank sync never change it'),
    isPlanned: shape.isPlanned.describe(
      'true marks it planned, false marks it as happened (see also confirm_planned_transaction in the subscriptions toolset)',
    ),
    excludeFromStats: shape.excludeFromStats.describe(
      'true keeps the transaction out of every spending/income report; balances and the transaction list are unaffected',
    ),
  },
  run: async ({ userId, args }) => {
    const { id, ...fields } = args;
    // The transfer, split and original-currency rules span fields, so they run on the REST body schema.
    const body = updateTransactionBodySchema.parse(fields);

    const result = await updateTransaction({
      id,
      userId,
      accountId: body.accountId,
      amount: body.amount !== undefined ? Money.fromDecimal(body.amount) : undefined,
      transactionType: body.transactionType,
      paymentType: body.paymentType,
      transferNature: body.transferNature,
      categoryId: body.categoryId,
      time: body.time ? new Date(body.time) : undefined,
      note: body.note,
      destinationAccountId: body.destinationAccountId,
      destinationAmount: body.destinationAmount !== undefined ? Money.fromDecimal(body.destinationAmount) : undefined,
      destinationTransactionId: body.destinationTransactionId,
      splits:
        body.splits === null
          ? null
          : body.splits?.map((s) => ({
              categoryId: s.categoryId,
              amount: Money.fromDecimal(s.amount),
              note: s.note,
            })),
      tagIds: body.tagIds,
      originalAmount: body.originalAmount != null ? Money.fromDecimal(body.originalAmount) : body.originalAmount,
      originalCurrencyCode: body.originalCurrencyCode,
      paymentLegs: body.paymentLegs && deserializePaymentLegs({ legs: body.paymentLegs }),
      externalUrl: body.externalUrl,
      externalReference: body.externalReference,
      location: body.location,
      payeeLocked: body.payeeLocked,
      isPlanned: body.isPlanned,
      excludeFromStats: body.excludeFromStats,
      // null clears the link, so only an omitted payeeId is left out
      ...(body.payeeId !== undefined ? { payeeId: body.payeeId } : {}),
    });

    return serializeTransactionTuple(result);
  },
});
