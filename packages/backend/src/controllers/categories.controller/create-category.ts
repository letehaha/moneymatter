import { CATEGORY_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as categoriesService from '@root/services/categories/create-category';
import * as onboardingService from '@services/user-settings/onboarding';
import { z } from 'zod';

const CreateCategoryPayloadSchema = z
  .object({
    name: z.string().min(1).max(200, 'The name must not exceed 200 characters'),
    icon: z.string().max(50, 'Icon name must not exceed 50 characters').nullable().optional(),
    type: z.enum(Object.values(CATEGORY_TYPES) as [string, ...string[]]).default(CATEGORY_TYPES.custom),
    defaultTagIds: z.array(recordId()).max(20, 'Maximum 20 tags allowed').optional(),
    applyDefaultTagsOnAiCategorization: z.boolean().optional(),
  })
  .and(
    z.union([
      z.object({
        parentId: recordId(),
        color: z
          .string()
          .regex(/^#[0-9A-F]{6}$/i)
          .optional(),
      }),
      z.object({
        parentId: z.undefined(),
        color: z.string().regex(/^#[0-9A-F]{6}$/i),
      }),
    ]),
  );

const schema = z.object({
  body: CreateCategoryPayloadSchema,
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
