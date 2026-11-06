import { getAllSystemCurrencies } from '@services/system-currencies';

import { defineTool } from '../define-tool';

export const listSupportedCurrenciesTool = defineTool({
  name: 'list_supported_currencies',
  toolset: 'currencies',
  access: 'read',
  description:
    'List every ISO 4217 currency the app supports, with its code, name and decimals. These are the codes add_user_currencies accepts.',
  run: async () => {
    const currencies = await getAllSystemCurrencies();
    return currencies.map((currency) => ({
      code: currency.code,
      name: currency.currency,
      decimals: currency.digits,
    }));
  },
});
