import { getUser, getUserBaseCurrency, getUserCurrencies } from '@services/user.service';

import { defineTool } from '../define-tool';

export const getUserProfileTool = defineTool({
  name: 'get_user_profile',
  toolset: 'core',
  access: 'read',
  description:
    "Get the user's base currency, configured currencies with exchange rates, and basic profile info. Call this first to understand the user's currency context.",
  run: async ({ userId }) => {
    const [user, baseCurrency, currencies] = await Promise.all([
      getUser(userId),
      getUserBaseCurrency({ userId }),
      getUserCurrencies({ userId }),
    ]);

    return {
      username: user?.username ?? null,
      baseCurrency: baseCurrency ? { code: baseCurrency.currencyCode } : null,
      currencies: currencies.map((c) => ({
        code: c.currencyCode,
        exchangeRate: c.exchangeRate,
        isDefaultCurrency: c.isDefaultCurrency,
      })),
    };
  },
});
