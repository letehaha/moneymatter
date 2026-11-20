import { deleteUserCurrencyBodySchema } from '@controllers/currencies/user-currency-body.schema';
import { deleteUserCurrency } from '@services/user.service';

import { defineTool } from '../define-tool';

export const deleteUserCurrencyTool = defineTool({
  name: 'delete_user_currency',
  toolset: 'currencies',
  access: 'delete',
  description:
    'Stop holding a currency. Refused for the base currency and for a currency that accounts or holdings still use.',
  input: deleteUserCurrencyBodySchema.shape,
  run: async ({ userId, args }) => {
    await deleteUserCurrency({ userId, currencyCode: args.currencyCode });
    return { deleted: true, currencyCode: args.currencyCode };
  },
});
