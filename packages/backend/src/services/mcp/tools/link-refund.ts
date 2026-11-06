import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { atLeastOneCentAmountSchema } from '@controllers/transactions.controller/schemas';
import { createSingleRefund } from '@services/tx-refunds/create-single-refund.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const linkRefundTool = defineTool({
  name: 'link_refund',
  toolset: 'core',
  access: 'write',
  description:
    'Mark an existing transaction as a refund of another transaction. Provide originalTxId (the transaction being refunded) and refundTxId (the refund transaction). The two transactions must have opposite types (income vs expense). Optionally target a specific split of the original. One refund can cover several purchases: call once per purchase, each with an amount; the amounts cannot exceed the refund, and in the same currency the amounts against one purchase or split cannot exceed it.',
  input: {
    originalTxId: z
      .string()
      .uuid()
      .nullable()
      .describe('ID of the original transaction being refunded. Pass null for a standalone refund'),
    refundTxId: recordId().describe('ID of the transaction that represents the refund'),
    splitId: z.string().optional().describe('UUID of a specific split on the original transaction this refund targets'),
    amount: atLeastOneCentAmountSchema()
      .optional()
      .describe(
        "Share of the refund transaction (decimal, in the refund transaction's currency) that this link covers. Omit to link the whole refund. Required on every link when one refund covers several purchases.",
      ),
  },
  run: async ({ userId, args }) => {
    const result = await createSingleRefund({
      userId,
      originalTxId: args.originalTxId,
      refundTxId: args.refundTxId,
      splitId: args.splitId,
      amount: args.amount === undefined ? undefined : Money.fromDecimal(args.amount),
    });

    return {
      id: result.id,
      originalTxId: result.originalTxId,
      refundTxId: result.refundTxId,
      splitId: result.splitId,
      amount: result.amount,
    };
  },
});
