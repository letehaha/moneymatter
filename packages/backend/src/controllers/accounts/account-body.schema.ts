import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, ACCOUNT_TYPES } from '@bt/shared/types';
import { currencyCode } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields, refineLogoFieldsOnCreate } from '@controllers/common/logo-fields.schema';
import { z } from 'zod';

/**
 * The account write bodies, shared by the REST controller and the MCP account tools so the two
 * paths accept exactly the same input. The MCP tools expose the `*Fields` objects as their
 * `inputSchema` and run the full schema in the handler, which adds the logo refinement.
 */

// `type` is not part of the MCP tool: a tool-created account is always a manual system account.
export const createAccountBodyFields = {
  accountCategory: z.nativeEnum(ACCOUNT_CATEGORIES).default(ACCOUNT_CATEGORIES.general),
  currencyCode: currencyCode(),
  name: z.string().trim().min(1),
  // Amount fields are decimals; callers convert them with `Money.fromDecimal`.
  initialBalance: z.number().optional().default(0),
  creditLimit: z.number().min(0).optional().default(0),
  // Absent key → column stays null; a brand domain and monogram letters evict each other.
  ...logoFieldsShape,
};

export const createAccountBodySchema = z
  .object({
    ...createAccountBodyFields,
    type: z.nativeEnum(ACCOUNT_TYPES).default(ACCOUNT_TYPES.system),
  })
  .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx }));

// `status` is not part of the MCP tool: archiving has its own tool with its side effects.
export const updateAccountBodyFields = {
  accountCategory: z.nativeEnum(ACCOUNT_CATEGORIES).optional(),
  name: z.string().trim().min(1).optional(),
  creditLimit: z.number().min(0).optional(),
  excludeFromStats: z.boolean().optional(),
  currentBalance: z.number().optional(),
  initialBalance: z.number().optional(),
  // Absent key → no change; a present key is written as given (null clears it), and a brand
  // domain and monogram letters evict each other.
  ...logoFieldsShape,
};

export const updateAccountBodySchema = z
  .object({
    ...updateAccountBodyFields,
    status: z.nativeEnum(ACCOUNT_STATUSES).optional(),
  })
  .superRefine((data, ctx) => refineLogoFields({ data, ctx }));
