import { CATEGORY_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

const colorSchema = () => z.string().regex(/^#[0-9A-F]{6}$/i);

const iconSchema = () => z.string().max(50, 'Icon name must not exceed 50 characters').nullable().optional();

const defaultTagIdsSchema = () => z.array(recordId()).max(20, 'Maximum 20 tags allowed').optional();

/** `parentId` and `color` live in the union of `createCategoryBodySchema`: color is required without a parent. */
export const createCategoryBodyFields = {
  name: z.string().min(1).max(200, 'The name must not exceed 200 characters'),
  icon: iconSchema(),
  type: z.enum(Object.values(CATEGORY_TYPES) as [string, ...string[]]).default(CATEGORY_TYPES.custom),
  defaultTagIds: defaultTagIdsSchema(),
  applyDefaultTagsOnAiCategorization: z.boolean().optional(),
};

export const createCategoryBodySchema = z.object(createCategoryBodyFields).and(
  z.union([
    z.object({
      parentId: recordId(),
      color: colorSchema().optional(),
    }),
    z.object({
      parentId: z.undefined(),
      color: colorSchema(),
    }),
  ]),
);

export const updateCategoryBodyShape = {
  name: z.string().min(1).max(200, 'The name must not exceed 200 characters').optional(),
  icon: iconSchema(),
  color: colorSchema().optional(),
  parentId: recordId().nullable().optional(),
  defaultTagIds: defaultTagIdsSchema(),
  applyDefaultTagsOnAiCategorization: z.boolean().optional(),
};

export const updateCategoryBodySchema = z
  .object(updateCategoryBodyShape)
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });
