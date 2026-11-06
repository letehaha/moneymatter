import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as categoriesService from '@services/categories/edit-category';
import { z } from 'zod';

import { updateCategoryBodySchema } from './shared-schemas';

const schema = z.object({
  body: updateCategoryBodySchema,
  params: z.object({
    id: recordId(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const { id: userId } = user;
  const { id: categoryId } = params;
  const { name, icon, color, parentId, defaultTagIds, applyDefaultTagsOnAiCategorization } = body;

  const data = await categoriesService.editCategory({
    categoryId,
    userId,
    name,
    icon,
    color,
    parentId,
    defaultTagIds,
    applyDefaultTagsOnAiCategorization,
  });

  return { data };
});
