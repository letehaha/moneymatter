import { CATEGORY_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import {
  createCategoryBodyFields,
  createCategoryBodySchema,
  updateCategoryBodyShape,
} from '@controllers/categories.controller/shared-schemas';
import { createCategory } from '@services/categories/create-category';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const createCategoryTool = defineTool({
  name: 'create_category',
  toolset: 'core',
  access: 'write',
  description:
    'Create a new transaction category. Supports nested categories via parentId — child categories inherit the parent color if none is provided. Use when the user wants a new category to classify transactions.',
  input: {
    name: createCategoryBodyFields.name.describe('Category name.'),
    color: updateCategoryBodyShape.color.describe('Hex color code (e.g. "#4CAF50"). Inherited from parent if omitted.'),
    icon: createCategoryBodyFields.icon.describe('Optional icon identifier for the category.'),
    parentId: recordId().optional().describe('ID of the parent category to create a subcategory.'),
    type: z
      .enum([CATEGORY_TYPES.custom, CATEGORY_TYPES.internal])
      .optional()
      .describe('Category type: "custom" (default, user-editable) or "internal" (system-managed).'),
    defaultTagIds: createCategoryBodyFields.defaultTagIds.describe(
      'Tag IDs (from get_tags) that new transactions in this category get by default. Max 20',
    ),
    applyDefaultTagsOnAiCategorization: createCategoryBodyFields.applyDefaultTagsOnAiCategorization.describe(
      'true also applies defaultTagIds when AI categorization picks this category',
    ),
  },
  validate: ({ args }) => {
    // A top-level category needs a color, a rule that spans fields, so it runs on the REST body schema.
    const { type, ...fields } = args;
    return { type, body: createCategoryBodySchema.parse(fields) };
  },
  run: async ({ userId, args: { type, body } }) => {
    const category = await createCategory({
      userId,
      name: body.name,
      icon: body.icon,
      color: body.color,
      parentId: body.parentId,
      type,
      defaultTagIds: body.defaultTagIds,
      applyDefaultTagsOnAiCategorization: body.applyDefaultTagsOnAiCategorization,
    });
    return category;
  },
});
