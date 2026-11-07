import { recordId } from '@common/lib/zod/custom-types';
import { deleteTag } from '@services/tags/delete-tag';

import { defineTool } from '../define-tool';

export const deleteTagTool = defineTool({
  name: 'delete_tag',
  toolset: 'core',
  access: 'delete',
  description:
    'Permanently delete a tag by ID. This is destructive — the tag will be removed and unlinked from all transactions. Only call when the user explicitly confirms deletion.',
  input: {
    id: recordId().describe('ID of the tag to delete.'),
  },
  run: ({ userId, args }) => deleteTag({ id: args.id, userId }),
});
