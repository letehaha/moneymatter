import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { positiveAmountSchema } from '@controllers/transactions.controller/schemas';
import { withTransaction } from '@services/common/with-transaction';
import { getTransactionById } from '@services/transactions/get-by-id';
import { manageSplits } from '@services/transactions/splits/manage-splits';
import { validateRefundLinks } from '@services/tx-refunds/validate-refund-links';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const splitTransactionTool = defineTool({
  name: 'split_transaction',
  toolset: 'core',
  access: 'write',
  description:
    'Split a transaction across multiple categories. Provide the transactionId and an array of splits whose amounts sum to the transaction total. Replaces any existing splits on the transaction.',
  input: {
    transactionId: recordId().describe('ID of the transaction to split'),
    splits: z
      .array(
        z.object({
          categoryId: recordId().describe('Category ID for this split portion'),
          amount: positiveAmountSchema().describe('Amount for this split portion (decimal, greater than 0)'),
          note: z.string().max(100).optional().nullable().describe('Optional note for this split'),
        }),
      )
      .min(1)
      .describe('Split portions — amounts must sum to the full transaction amount'),
  },
  run: async ({ userId, args }) => {
    const result = await withTransaction(async () => {
      const fetched = await getTransactionById({
        id: args.transactionId,
        userId,
        requiredPermission: SHARE_PERMISSIONS.write,
      });
      if (!fetched) {
        throw new Error(`Transaction ${args.transactionId} not found`);
      }
      const transaction = fetched.tx;

      const splits = await manageSplits({
        transactionId: args.transactionId,
        userId,
        categoryOwnerUserId: fetched.access.ownerUserId,
        splits: args.splits.map((s) => ({
          categoryId: s.categoryId,
          amount: Money.fromDecimal(s.amount),
          note: s.note,
        })),
        transactionAmount: transaction.amount,
        transactionCurrencyCode: transaction.currencyCode,
        transactionTime: transaction.time,
        transferNature: transaction.transferNature,
      });

      await validateRefundLinks({ userId: transaction.userId, txId: transaction.id });
      return splits;
    })();

    return result.map((split) => ({
      id: split.id,
      transactionId: split.transactionId,
      categoryId: split.categoryId,
      amount: split.amount.toNumber(),
      refAmount: split.refAmount.toNumber(),
      note: split.note,
    }));
  },
});
