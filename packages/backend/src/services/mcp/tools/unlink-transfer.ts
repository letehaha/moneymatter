import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { unlinkTransferTransactions } from '@services/transactions/transactions-linking/unlink-transfer-transactions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const unlinkTransferTool = defineTool({
  name: 'unlink_transfer',
  toolset: 'core',
  access: 'write',
  description:
    'Unlink transfer transactions by their shared transferId (UUID string). Both transactions in the pair will become independent income/expense entries. Use search_transactions to find the transferId of a linked pair.',
  input: {
    transferIds: z
      .array(z.string())
      .min(1)
      .describe('One or more transferId UUID strings identifying transfer pairs to unlink'),
  },
  run: async ({ userId, args }) => {
    const result = await unlinkTransferTransactions({ userId, transferIds: args.transferIds });

    return serializeTransactions(result);
  },
});
