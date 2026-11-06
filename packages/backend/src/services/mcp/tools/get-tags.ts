import { recordId } from '@common/lib/zod/custom-types';
import { getTagById } from '@services/tags/get-tag-by-id';
import { getTags } from '@services/tags/get-tags';

import { defineTool } from '../define-tool';

export const getTagsTool = defineTool({
  name: 'get_tags',
  toolset: 'core',
  access: 'read',
  description:
    'List all user tags. Returns tag ID, name, color, and icon. Pass tagId to read one tag, which also includes its description.',
  input: {
    tagId: recordId().optional().describe('Tag id. When given, returns that one tag with its description.'),
  },
  run: async ({ userId, args }) => {
    if (args.tagId) {
      const tag = await getTagById({ id: args.tagId, userId });
      return { id: tag.id, name: tag.name, color: tag.color, icon: tag.icon, description: tag.description };
    }

    const tags = await getTags({ userId });
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, icon: t.icon }));
  },
});
