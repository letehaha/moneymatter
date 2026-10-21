import { currencyCode, dateBound } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { ExchangeRateUnavailableError, NotFoundError } from '@js/errors';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';
import * as userExchangeRateService from '@services/user-exchange-rate';
import { z } from 'zod';

const schema = z.object({
  query: z.object({
    from: currencyCode(),
    to: currencyCode(),
    date: dateBound(),
  }),
});

export default createController(schema, async ({ user, query }) => {
  const { from, to, date } = query;

  await assertCurrencyCodesVisible({ userId: user.id, codes: [from, to] });

  try {
    const data = await userExchangeRateService.getExchangeRate({
      userId: user.id,
      baseCode: from,
      quoteCode: to,
      date: new Date(date),
      requireUserConnection: false,
    });

    return { data };
  } catch (err) {
    // A pair with no published rate is a routine miss here: answer 404 instead of the 500
    // the error carries by default.
    if (err instanceof ExchangeRateUnavailableError) {
      throw new NotFoundError({ message: err.message });
    }
    throw err;
  }
});
