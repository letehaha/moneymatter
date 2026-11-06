import { updatePayeeBodyShape } from '@controllers/payees/shared-schemas';
import { createPayee } from '@services/payees';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentPayee } from './payee-output';

export const createPayeeTool = defineTool({
  name: 'create_payee',
  toolset: 'core',
  access: 'write',
  description:
    'Create a Payee (merchant/counterparty) for the user. Use when the user wants to register a new merchant before linking transactions. Can also set the categorization mode, the default tags and the default location. Returns the created Payee.',
  input: {
    name: z.string().describe('Display name for the Payee, max 200 chars.'),
    defaultCategoryId: z
      .string()
      .optional()
      .describe('Optional category id automatically applied to future transactions linked to this Payee.'),
    categorizationMode: updatePayeeBodyShape.categorizationMode.describe(
      'How the default category is used on new transactions: enforce (always set it, the default), hint (suggest it) or off (ignore it).',
    ),
    defaultTagIds: updatePayeeBodyShape.defaultTagIds.describe(
      'Tag ids (from get_tags) added to new transactions of this payee. Use apply_payee_tags_to_transactions (automations toolset) to tag the existing transactions.',
    ),
    defaultLocation: updatePayeeBodyShape.defaultLocation.describe(
      'Default location { latitude, longitude } stamped on new transactions of this payee.',
    ),
  },
  run: async ({ userId, args }) => {
    const payee = await createPayee({
      userId,
      name: args.name,
      defaultCategoryId: args.defaultCategoryId ?? null,
      categorizationMode: args.categorizationMode,
      defaultTagIds: args.defaultTagIds,
      defaultLocation: args.defaultLocation,
    });
    return presentPayee({ payee });
  },
});
