import { createController } from '@controllers/helpers/controller-factory';
import * as userCurrenciesService from '@services/currencies/add-user-currency';
import { z } from 'zod';

import { addUserCurrenciesBodySchema } from './user-currency-body.schema';

const schema = z.object({
  body: addUserCurrenciesBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const { currencies } = body;

  const data = await userCurrenciesService.addUserCurrencies(currencies.map((item) => ({ userId, ...item })));

  return { data };
});
