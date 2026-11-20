import { recordId } from '@common/lib/zod/custom-types';
import { getRefundsForTransactionById } from '@services/tx-refunds/get-refund-for-transaction-by-id.service';

import { defineTool } from '../define-tool';

export const getRefundLinksTool = defineTool({
  name: 'get_refund_links',
  toolset: 'core',
  access: 'read',
  description:
    "List every refund link touching a transaction, on either side (as the refund or as the original). Each link has refundTxId, originalTxId (null for a purchase outside the app), splitId, and amount: the share of the refund transaction's amount in the refund's currency; null means the whole refund.",
  input: {
    transactionId: recordId().describe('ID of a transaction on either side of the links (the refund or the original)'),
  },
  run: async ({ userId, args }) => {
    const links = await getRefundsForTransactionById({ userId, transactionId: args.transactionId });

    return links.map((l) => ({
      refundTxId: l.refundTxId,
      originalTxId: l.originalTxId,
      splitId: l.splitId,
      amount: l.amount ? l.amount.toNumber() : null,
    }));
  },
});
