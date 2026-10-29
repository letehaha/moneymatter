import { CATEGORIZATION_MODE } from '@bt/shared/types';
import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { locationSchema } from '@controllers/transactions.controller/schemas';
import { z } from 'zod';

export const MAX_BULK_DELETE_PAYEE_IDS = 2000;

/**
 * Fields of a Payee update: the REST controller and the MCP tool share them. Absent key = no
 * change; a logo key that changes the stored value stamps logoSource 'manual'; a null that
 * clears nothing writes nothing.
 */
export const updatePayeeBodyShape = {
  name: z.string().trim().min(1).max(200).optional(),
  defaultCategoryId: recordId().nullable().optional(),
  categorizationMode: z.nativeEnum(CATEGORIZATION_MODE).optional(),
  defaultTagIds: z.array(recordId()).optional(),
  defaultLocation: locationSchema.nullable().optional(),
  ...logoFieldsShape,
};

export const updatePayeeBodySchema = z
  .object(updatePayeeBodyShape)
  .superRefine((data, ctx) => refineLogoFields({ data, ctx }));

export const bulkUpdateCategorizationModeBodySchema = z.object({
  mode: z.nativeEnum(CATEGORIZATION_MODE),
});

export const bulkDeletePayeesBodySchema = z.object({
  ids: uniqueRecordIds({ min: 1, max: MAX_BULK_DELETE_PAYEE_IDS }),
  ignoreFuture: z.boolean().optional().default(false),
});

export const addIgnoredNameBodySchema = z.object({
  rawName: z.string().trim().min(1).max(500),
  /** Delete the Payee the name resolves to, instead of refusing with 409. */
  force: z.boolean().optional(),
});

export const createPayeeAliasBodySchema = z.object({
  rawName: z.string().trim().min(1).max(500),
});
