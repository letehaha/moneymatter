import { currencyCode } from '@common/lib/zod/custom-types';
import { deleteCustomCurrency } from '@services/currencies/custom-currencies.service';

import { defineTool } from '../define-tool';

export const deleteCustomCurrencyTool = defineTool({
  name: 'delete_custom_currency',
  toolset: 'currencies',
  access: 'delete',
  description:
    "Permanently delete one of the user's custom currencies together with the user's own exchange rates for it. Refused while any account, transaction or other row of the user uses the currency; the error lists where.",
  input: {
    code: currencyCode().describe('Code of the custom currency to delete.'),
  },
  run: async ({ userId, args }) => {
    await deleteCustomCurrency({ userId, code: args.code });
    return { deleted: true, code: args.code };
  },
});
