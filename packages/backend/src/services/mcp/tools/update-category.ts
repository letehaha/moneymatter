import { recordId } from '@common/lib/zod/custom-types';
import { updateCategoryBodySchema, updateCategoryBodyShape } from '@controllers/categories.controller/shared-schemas';
import { editCategory } from '@services/categories/edit-category';

import { defineTool } from '../define-tool';

export const updateCategoryTool = defineTool({
  name: 'update_category',
  toolset: 'core',
  access: 'write',
  description:
    'Update an existing category by ID. Use when the user wants to rename, recolor, re-icon, move or set the default tags of a category. Returns the updated category records.',
  input: {
    categoryId: recordId().describe('ID of the category to update.'),
    name: updateCategoryBodyShape.name.describe('New category name.'),
    color: updateCategoryBodyShape.color.describe('New hex color code (e.g. "#4CAF50").'),
    icon: updateCategoryBodyShape.icon.describe('New icon identifier, or null to clear it.'),
    parentId: updateCategoryBodyShape.parentId.describe(
      'Move under this parent category ID, or null to make it top-level. Omit to keep it where it is',
    ),
    defaultTagIds: updateCategoryBodyShape.defaultTagIds.describe(
      'Replaces the default tags (IDs from get_tags); [] clears them. Max 20',
    ),
    applyDefaultTagsOnAiCategorization: updateCategoryBodyShape.applyDefaultTagsOnAiCategorization.describe(
      'true also applies defaultTagIds when AI categorization picks this category',
    ),
  },
  validate: ({ args }) => {
    const { categoryId, ...fields } = args;
    return { categoryId, ...updateCategoryBodySchema.parse(fields) };
  },
  run: ({ userId, args }) => editCategory({ userId, ...args }),
});
