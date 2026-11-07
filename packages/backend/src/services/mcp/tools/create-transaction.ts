import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import {
  createTransactionBodySchema,
  createTransactionBodyShape as shape,
} from '@controllers/transactions.controller/schemas';
import { deserializeCreateTransaction, serializeTransactionTuple } from '@root/serializers';
import { createTransaction } from '@services/transactions/create-transaction';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const createTransactionTool = defineTool({
  name: 'create_transaction',
  toolset: 'core',
  access: 'write',
  description:
    "Create a new transaction (income, expense, or transfer). Requires accountId, amount (decimal), transactionType, and transferNature. paymentType is optional and defaults to the default payment type of the account. For transfers, also provide destinationAccountId and destinationAmount. Use splits to categorize portions of the amount. Use originalAmount + originalCurrencyCode to record what the purchase cost in its invoice currency when that differs from the account currency. Use paymentLegs to pay one purchase from several accounts. Use payeeId to link an existing payee, or merchantName to let the server resolve a payee from a raw merchant name (it matches an existing payee by name or alias and follows the instance's normal promotion rules, so it may not create a payee on first sight); the two cannot be combined.",
  input: {
    accountId: shape.accountId.describe('ID of the account the transaction belongs to'),
    amount: shape.amount.describe(
      'Transaction amount as an unsigned decimal (e.g. 12.50). Never negative: transactionType sets the direction',
    ),
    transactionType: shape.transactionType.describe('Whether this is income or expense'),
    paymentType: shape.paymentType.describe(
      "Payment method used. Defaults to the account's default payment type, or bankTransfer",
    ),
    transferNature: z
      .enum([
        TRANSACTION_TRANSFER_NATURE.not_transfer,
        TRANSACTION_TRANSFER_NATURE.common_transfer,
        TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      ])
      .describe('Transfer type. Use not_transfer for regular income/expense'),
    categoryId: recordId().optional().describe('Category ID to assign to this transaction'),
    time: shape.time.describe('Transaction date/time as ISO 8601 string. Defaults to now'),
    note: shape.note.describe('Optional note or description for the transaction'),
    destinationAccountId: shape.destinationAccountId.describe('For transfers: destination account ID'),
    destinationAmount: shape.destinationAmount.describe(
      'For transfers: amount received in destination account (decimal, greater than 0)',
    ),
    destinationTransactionId: shape.destinationTransactionId.describe(
      'For transfers: link to an existing destination transaction instead of creating one',
    ),
    splits: shape.splits.describe(
      'Split the transaction across multiple categories. Each item: { categoryId, amount (decimal, greater than 0), note (optional) }',
    ),
    tagIds: shape.tagIds.describe('Tag IDs to assign to this transaction'),
    isPlanned: shape.isPlanned.describe('Mark the transaction as planned rather than an already-happened record'),
    payeeId: shape.payeeId.describe(
      'ID of an existing payee to link (from get_payees). Cannot be combined with merchantName',
    ),
    merchantName: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Raw merchant name, resolved to a payee the way bank sync and imports do: an existing payee is matched by name or alias, and a new one is created only once the name has repeated enough (the instance promotion rule). Cannot be combined with payeeId',
      ),
    originalAmount: shape.originalAmount.describe(
      'Amount in the currency the purchase was originally priced in (decimal), e.g. 66.42 for a PLN invoice paid from a UAH account. Informational only: never affects balances. Requires originalCurrencyCode',
    ),
    originalCurrencyCode: shape.originalCurrencyCode.describe(
      'ISO 4217 code of originalAmount (e.g. "PLN"). Requires originalAmount. Cannot be combined with transfer fields',
    ),
    paymentLegs: shape.paymentLegs.describe(
      "Pay this income/expense from up to 4 more accounts. Each item is either { accountId, amount } to create a part on another account, or { transactionId } to link an existing transaction as a part (its amount stays). amount is in that account's currency; when it differs from this transaction's currency also pass paymentAmount, the part's value in this transaction's currency. Not allowed for transfers, refunds, planned or category-split transactions",
    ),
    externalUrl: shape.externalUrl.describe(
      'http(s) link to the source document, e.g. an invoice (max 2048 characters)',
    ),
    externalReference: shape.externalReference.describe(
      'External reference such as an invoice or order number (max 255 characters)',
    ),
    location: shape.location.describe('Where it happened: { latitude, longitude } in degrees'),
    payeeLocked: shape.payeeLocked.describe('true pins the payee so later automations and bank sync never change it'),
    applyAutomations: shape.applyAutomations.describe(
      "true runs the user's enabled automation rules on this transaction. Default false",
    ),
  },
  run: async ({ userId, args }) => {
    const { merchantName, ...fields } = args;
    if (fields.payeeId != null && merchantName) {
      throw new Error('"payeeId" and "merchantName" cannot be used together');
    }
    // The transfer, split and original-currency rules span fields, so they run on the REST body schema.
    const body = createTransactionBodySchema.parse(fields);

    const params = deserializeCreateTransaction(body, userId);

    const result = await createTransaction({ ...params, rawMerchantName: merchantName });
    return serializeTransactionTuple(result);
  },
});
