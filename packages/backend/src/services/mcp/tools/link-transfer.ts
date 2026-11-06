import { recordId } from '@common/lib/zod/custom-types';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { linkTransactions } from '@services/transactions/transactions-linking/link-transactions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const linkTransferTool = defineTool({
  name: 'link_transfer',
  toolset: 'core',
  access: 'write',
  description:
    'Link two existing transactions as a transfer pair. The two transactions must be in different accounts and have opposite types (one income, one expense). Provide baseTxId (the source/expense side) and oppositeTxId (the destination/income side).',
  input: {
    baseTxId: recordId().describe('ID of the base (source) transaction — typically the expense side'),
    oppositeTxId: z
      .string()
      .uuid()
      .describe('ID of the opposite (destination) transaction — typically the income side'),
  },
  run: async ({ userId, args }) => {
    const results = await linkTransactions({
      userId,
      ids: [[args.baseTxId, args.oppositeTxId]],
    });

    const [baseTx, oppositeTx] = results[0]!;

    return serializeTransactions([baseTx, oppositeTx]);
  },
});
