import { createTagBodyShape } from '@controllers/tags/shared-schemas';
import { createTag } from '@services/tags/create-tag';

import { defineTool } from '../define-tool';

export const createTagTool = defineTool({
  name: 'create_tag',
  toolset: 'core',
  access: 'write',
  description:
    'Create a new tag that can be assigned to transactions. Use when the user wants to label or categorize transactions with a custom tag. Returns the created tag with its ID.',
  input: {
    name: createTagBodyShape.name.describe('Tag name (must be unique for this user).'),
    color: createTagBodyShape.color.describe('Hex color code for the tag (e.g. "#FF5733").'),
    icon: createTagBodyShape.icon.describe('Optional icon identifier for the tag.'),
    description: createTagBodyShape.description.describe('Optional description of the tag.'),
  },
  run: async ({ userId, args }) => {
    const tag = await createTag({ userId, ...args });
    return tag;
  },
});
