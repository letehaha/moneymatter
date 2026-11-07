import { centsToApiDecimal } from '@common/types/money';
import { listPayees } from '@services/payees';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getPayeesTool = defineTool({
  name: 'get_payees',
  toolset: 'core',
  access: 'read',
  description:
    'List Payees (merchants/counterparties) for the user, optionally filtered by a substring query. Returns Payee id, name, defaultCategoryId, and aggregated stats (transactionCount, netFlowRef, top category, last seen).',
  input: {
    q: z.string().optional().describe('Substring filter applied to the normalized Payee name.'),
  },
  run: async ({ userId, args }) => {
    const rows = await listPayees({ userId, q: args.q });
    return rows.map(({ payee, stats }) => ({
      id: payee.id,
      name: payee.name,
      defaultCategoryId: payee.defaultCategoryId,
      transactionCount: stats?.transactionCount ?? 0,
      netFlowRef: stats ? centsToApiDecimal(stats.netFlowRefCents) : 0,
      firstSeenAt: stats?.firstSeenAt ?? null,
      lastSeenAt: stats?.lastSeenAt ?? null,
      topCategoryId: stats?.topCategoryId ?? null,
    }));
  },
});
