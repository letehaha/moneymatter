import {
  createParseController,
  fileContentParseSchema,
} from '@controllers/import-export/helpers/create-parse-controller';
import { getOwnCustomCurrencyCodes } from '@root/services/currencies/assert-currency-codes-visible';
import { parseYnabRegister } from '@root/services/import-export/ynab-import/parse-ynab.service';

export const parseYnabController = createParseController({
  schema: fileContentParseSchema,
  parse: async ({ fileContent }, { userId }) =>
    parseYnabRegister({ fileContent, customCurrencyCodes: await getOwnCustomCurrencyCodes({ userId }) }),
});
