import { centsToApiDecimal } from '@common/types/money';
import { getPayee } from '@services/payees';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPayeeTool = defineTool({
  name: 'get_payee',
  toolset: 'core',
  access: 'read',
  description:
    'Fetch a single Payee with aliases and computed stats. Useful when the user references a merchant by id and wants its full record.',
  input: {
    id: z.string().describe('Payee id.'),
  },
  run: async ({ userId, args }) => {
    const { payee, stats } = await getPayee({ userId, id: args.id });
    return {
      id: payee.id,
      name: payee.name,
      defaultCategoryId: payee.defaultCategoryId,
      aliases:
        payee.aliases?.map((a) => ({
          id: a.id,
          rawName: a.rawName,
          normalizedName: a.normalizedName,
        })) ?? [],
      stats: stats
        ? {
            payeeId: stats.payeeId,
            transactionCount: stats.transactionCount,
            netFlowRef: centsToApiDecimal(stats.netFlowRefCents),
            firstSeenAt: stats.firstSeenAt,
            lastSeenAt: stats.lastSeenAt,
            topCategoryId: stats.topCategoryId,
          }
        : null,
    };
  },
});
