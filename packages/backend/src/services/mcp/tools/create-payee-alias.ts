import { recordId } from '@common/lib/zod/custom-types';
import { createPayeeAliasBodySchema } from '@controllers/payees/shared-schemas';
import { createPayeeAlias } from '@services/payees';

import { defineTool } from '../define-tool';
import { presentPayee } from './payee-output';

const bodyShape = createPayeeAliasBodySchema.shape;

export const createPayeeAliasTool = defineTool({
  name: 'create_payee_alias',
  toolset: 'automations',
  access: 'write',
  description:
    "Add an alias to a payee: another name that links future transactions to it. Refused when the name is already the payee's own name or an alias, or belongs to another payee (use merge_payees to join two payees). Existing transactions are not re-linked. Returns the payee with its aliases.",
  input: {
    payeeId: recordId().describe('Payee the alias belongs to (from get_payees).'),
    rawName: bodyShape.rawName.describe(
      'The name as it appears on transactions, e.g. "NFLX*SUBSCRIPTION" (1 to 500 characters).',
    ),
  },
  run: async ({ userId, args }) => {
    const payee = await createPayeeAlias({ userId, payeeId: args.payeeId, rawName: args.rawName });
    return presentPayee({ payee });
  },
});
