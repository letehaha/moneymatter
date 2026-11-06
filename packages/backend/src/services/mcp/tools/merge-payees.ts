import { mergePayees } from '@services/payees';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const mergePayeesTool = defineTool({
  name: 'merge_payees',
  toolset: 'core',
  access: 'delete',
  description:
    'Merge a source Payee into a target Payee. Transactions and aliases move to the target; the target wins silently on defaultCategoryId conflict; the source is deleted. Use to dedupe near-duplicates like "Amazon" and "AMZN MKT".',
  input: {
    sourceId: z.string().describe('Payee id to merge from (will be deleted).'),
    targetId: z.string().describe('Payee id to merge into (kept).'),
  },
  run: async ({ userId, args }) => {
    const target = await mergePayees({
      userId,
      sourceId: args.sourceId,
      targetId: args.targetId,
    });
    return {
      id: target.id,
      name: target.name,
      defaultCategoryId: target.defaultCategoryId,
    };
  },
});
