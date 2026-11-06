import { deleteSplit } from '@services/transactions/splits/delete-split';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteSplitTool = defineTool({
  name: 'delete_split',
  toolset: 'core',
  access: 'delete',
  description:
    'Delete a single split from a transaction by its split ID (UUID string). DESTRUCTIVE: the split amount returns to the primary category. Fails if the split has refunds targeting it.',
  input: {
    splitId: z.string().describe('UUID of the split to delete'),
  },
  run: ({ userId, args }) => deleteSplit({ splitId: args.splitId, userId }),
});
