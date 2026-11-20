import { getUserExchangeRates } from '@services/user-exchange-rate';
import { getUserBaseCurrency, getUserCurrencies } from '@services/user.service';

import { defineTool } from '../define-tool';

export const getUserCurrenciesTool = defineTool({
  name: 'get_user_currencies',
  toolset: 'currencies',
  access: 'read',
  description:
    "Get the currencies the user holds: baseCurrency (the reporting currency, null before one is set), currencies (every held currency with its settings: liveRateUpdate and exchangeRate) and exchangeRates (today's rate of each currency to the base). Use list_supported_currencies for the codes that can still be added.",
  run: async ({ userId }) => {
    const [currencies, baseCurrency, exchangeRates] = await Promise.all([
      getUserCurrencies({ userId }),
      getUserBaseCurrency({ userId }),
      getUserExchangeRates({ userId }),
    ]);
    return { baseCurrency: baseCurrency ?? null, currencies, exchangeRates };
  },
});
