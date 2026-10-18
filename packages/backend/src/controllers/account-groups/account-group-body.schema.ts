import { recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields, refineLogoFieldsOnCreate } from '@controllers/common/logo-fields.schema';
import { z } from 'zod';

/**
 * The account group write bodies, shared by the REST controllers and the MCP account group tools
 * so the two paths accept exactly the same input. The MCP tools expose the `*Fields` objects as
 * their `inputSchema` and run the full schema in the handler, which adds the logo refinement.
 */

export const createAccountGroupBodyFields = {
  name: z.string().min(1),
  parentGroupId: recordId().nullable().optional(),
  // Absent key → column stays null; a brand domain and monogram letters evict each other.
  ...logoFieldsShape,
};

export const createAccountGroupBodySchema = z
  .object(createAccountGroupBodyFields)
  .strict()
  .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx }));

export const updateAccountGroupBodyFields = {
  name: z.string().min(1).optional(),
  parentGroupId: recordId().nullable().optional(),
  // Absent key → no change; a present key is written as given (null clears it), and a brand
  // domain and monogram letters evict each other.
  ...logoFieldsShape,
};

export const updateAccountGroupBodySchema = z
  .object(updateAccountGroupBodyFields)
  .strict()
  .superRefine((data, ctx) => refineLogoFields({ data, ctx }));
