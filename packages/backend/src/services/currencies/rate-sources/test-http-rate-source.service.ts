import type { TestCurrencyRateSourceResponse } from '@bt/shared/types';
import { t } from '@i18n/index';
import { toEffectiveDate } from '@models/user-exchange-rates.model';
import { z } from 'zod';

import { fetchHttpRate, HttpRateSourceError } from './http';
import { type testRateSourceBodySchema } from './index';
import { assertHttpSourceAllowed, findHeldCurrency, resolveHttpHeaders } from './set-rate-source.service';

/**
 * Asks an HTTP source for the rate of one day without saving anything, so the editor can show the
 * price the settings produce before they are kept. A request that fails is an answer, not an error:
 * `ok: false` says why (the saved headers can no longer be read, for one). A body the source may not be set with (a currency that is not the user's,
 * an ISO currency, a quote that is not ISO, http on a cloud instance) is rejected like a save.
 */
export const testHttpRateSource = async ({
  userId,
  code,
  body,
}: {
  userId: number;
  code: string;
  body: z.infer<typeof testRateSourceBodySchema>;
}): Promise<TestCurrencyRateSourceResponse> => {
  const held = await findHeldCurrency({ userId, code });
  await assertHttpSourceAllowed({ userId, code, held, config: body.config });

  const headers = resolveHttpHeaders({ body, held });
  if (headers === null) {
    return {
      ok: false,
      reason: 'headers_unreadable',
      message: t({ key: 'currencies.rateSourceHeadersUnreadable', variables: { code } }),
    };
  }

  const date = body.date ?? toEffectiveDate({ date: new Date() });
  const { urlTemplate, jsonPath, quoteCurrency } = body.config;

  try {
    const rate = await fetchHttpRate({ urlTemplate, jsonPath, quoteCurrency, code, day: date, headers });

    return { ok: true, date, rate, quoteCurrency };
  } catch (error) {
    if (error instanceof HttpRateSourceError) return { ok: false, reason: error.reason, message: error.message };

    throw error;
  }
};
