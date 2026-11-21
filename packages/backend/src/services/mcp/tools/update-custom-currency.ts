import {
  updateCustomCurrencyBodyFields,
  updateCustomCurrencyBodySchema,
} from '@common/lib/zod/custom-currency-schemas';
import { currencyCode } from '@common/lib/zod/custom-types';
import { updateCustomCurrency } from '@services/currencies/custom-currencies.service';

import { defineTool } from '../define-tool';

export const updateCustomCurrencyTool = defineTool({
  name: 'update_custom_currency',
  toolset: 'currencies',
  access: 'write',
  description:
    "Update one of the user's custom currencies. Send only the fields to change: name, decimals, symbol (null clears) and the logo as one of logoDomain, logoInitials or logoIcon, with logoColor behind initials or an icon (null clears each). A decimals change is refused while the user has accounts, transactions on shared accounts or other rows in this currency; foreign amounts in this currency on the user's transactions are cleared. Returns the updated currency.",
  input: {
    code: currencyCode().describe('Code of the custom currency to update.'),
    ...updateCustomCurrencyBodyFields,
  },
  run: ({ userId, args }) => {
    const { code, ...body } = args;
    return updateCustomCurrency({ userId, code, ...updateCustomCurrencyBodySchema.parse(body) });
  },
});
