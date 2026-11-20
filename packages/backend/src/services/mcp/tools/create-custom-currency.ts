import { createCustomCurrencyBodySchema } from '@common/lib/zod/custom-currency-schemas';
import { createCustomCurrency } from '@services/currencies/custom-currencies.service';

import { defineTool } from '../define-tool';

export const createCustomCurrencyTool = defineTool({
  name: 'create_custom_currency',
  toolset: 'currencies',
  access: 'write',
  description:
    'Define a custom currency for the user (points, crypto tokens, a local unit). The code is 2 to 16 letters or digits and must not be an ISO code or one the user already defined; decimals is how many fractional digits amounts keep. Custom currencies are per user, and they need a rate source or manual rates before their base-currency values are known. Returns the created currency.',
  input: createCustomCurrencyBodySchema.shape,
  run: ({ userId, args }) => createCustomCurrency({ userId, ...createCustomCurrencyBodySchema.parse(args) }),
});
