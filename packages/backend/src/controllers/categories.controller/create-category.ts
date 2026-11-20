import { createController } from '@controllers/helpers/controller-factory';
import * as categoriesService from '@root/services/categories/create-category';
import * as onboardingService from '@services/user-settings/onboarding';
import { z } from 'zod';

import { createCategoryBodySchema } from './shared-schemas';

const schema = z.object({
  body: createCategoryBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const { name, icon, color, parentId, defaultTagIds, applyDefaultTagsOnAiCategorization } = body;

  const data = await categoriesService.createCategory({
    name,
    icon,
    color,
    parentId,
    defaultTagIds,
    applyDefaultTagsOnAiCategorization,
    userId,
  });

  // Mark onboarding task as complete (fire and forget)
  onboardingService.markTaskComplete({ userId, taskId: 'create-category' }).catch(() => {});

  return { data };
});
