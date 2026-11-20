import { editUserCurrencyBodySchema } from '@controllers/currencies/user-currency-body.schema';
import { editUserCurrency } from '@services/user.service';

import { defineTool } from '../define-tool';

export const updateUserCurrencyTool = defineTool({
  name: 'update_user_currency',
  toolset: 'currencies',
  access: 'write',
  description:
    'Change how one held currency is valued: exchangeRate (the flat rate to the base currency) and liveRateUpdate (true follows the market rate, false keeps the manual one). Switching liveRateUpdate re-values the stored balances, which can take a moment. The user must already hold the currency (see get_user_currencies). Returns the updated currency.',
  input: editUserCurrencyBodySchema.shape,
  run: ({ userId, args }) =>
    editUserCurrency({
      userId,
      currencyCode: args.currencyCode,
      exchangeRate: args.exchangeRate,
      liveRateUpdate: args.liveRateUpdate,
    }),
});
