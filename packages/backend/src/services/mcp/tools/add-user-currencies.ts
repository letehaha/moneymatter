import { addUserCurrenciesBodySchema } from '@controllers/currencies/user-currency-body.schema';
import { addUserCurrencies } from '@services/currencies/add-user-currency';

import { defineTool } from '../define-tool';

export const addUserCurrenciesTool = defineTool({
  name: 'add_user_currencies',
  toolset: 'currencies',
  access: 'write',
  description:
    'Add currencies to the ones the user holds, so accounts and transactions can use them. Each entry is { currencyCode, exchangeRate? (> 0, the flat rate to the base currency), liveRateUpdate? (true follows the market, false keeps the manual rate) }. A code must be an ISO currency (see list_supported_currencies). Codes the user already holds are skipped and listed in alreadyExistingCodes.',
  input: addUserCurrenciesBodySchema.shape,
  run: ({ userId, args }) => addUserCurrencies(args.currencies.map((currency) => ({ userId, ...currency }))),
});
