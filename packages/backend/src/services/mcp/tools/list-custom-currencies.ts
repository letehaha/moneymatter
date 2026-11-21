import { listCustomCurrencies } from '@services/currencies/custom-currencies.service';

import { defineTool } from '../define-tool';

export const listCustomCurrenciesTool = defineTool({
  name: 'list_custom_currencies',
  toolset: 'currencies',
  access: 'read',
  description:
    "List the user's custom currencies (their own units such as points or crypto tokens, not ISO codes). Returns code, name, symbol, decimals and the logo fields (logoDomain, logoInitials, logoColor, logoIcon, logoImageId) for each.",
  run: ({ userId }) => listCustomCurrencies({ userId }),
});
