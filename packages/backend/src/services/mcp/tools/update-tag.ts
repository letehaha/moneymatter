import { recordId } from '@common/lib/zod/custom-types';
import { updateTagBodyShape } from '@controllers/tags/shared-schemas';
import { updateTag } from '@services/tags/update-tag';

import { defineTool } from '../define-tool';

export const updateTagTool = defineTool({
  name: 'update_tag',
  toolset: 'core',
  access: 'write',
  description:
    'Update an existing tag by ID. Use when the user wants to rename, recolor, or change the icon/description of a tag. Returns the updated tag.',
  input: {
    id: recordId().describe('ID of the tag to update.'),
    name: updateTagBodyShape.name.describe('New tag name (must be unique for this user).'),
    color: updateTagBodyShape.color.describe('New hex color code for the tag (e.g. "#FF5733").'),
    icon: updateTagBodyShape.icon.describe('New icon identifier, or null to clear it.'),
    description: updateTagBodyShape.description.describe('New description, or null to clear it.'),
  },
  run: ({ userId, args }) => updateTag({ userId, ...args }),
});
