import { currencyCode } from '@common/lib/zod/custom-types';
import { RATE_SOURCE_TEST_LIMIT } from '@services/common/user-rate-limits';
import { httpRateSourceConfigSchema, testRateSourceBodySchema } from '@services/currencies/rate-sources';
import { testHttpRateSource } from '@services/currencies/rate-sources/test-http-rate-source.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { enforceUserRateLimit } from './helpers';

export const testCurrencyRateSourceTool = defineTool({
  name: 'test_currency_rate_source',
  toolset: 'currencies',
  access: 'write',
  // POST /user/currencies/:code/rate-source/test saves nothing, so its route has no base-currency lock.
  lock: false,
  description:
    'Try an HTTP rate source for one day without saving anything: the server fetches the filled URL and reads the price at jsonPath. Returns { ok: true, date, rate, quoteCurrency }, or { ok: false, reason, message } when the request fails or the price is not found. Use it before set_currency_rate_source with an http source. Rate limited to 20 previews per minute.',
  input: {
    code: currencyCode().describe('Code of the custom currency the source would price.'),
    config: httpRateSourceConfigSchema.describe(
      'The HTTP source to try: { urlTemplate, jsonPath, quoteCurrency?, headers? }. quoteCurrency is an ISO code. Omit headers to use the saved ones.',
    ),
    date: z.iso.date().optional().describe('The day to ask for (YYYY-MM-DD). Defaults to today.'),
  },
  run: async ({ userId, args }) => {
    await enforceUserRateLimit({ userId, limit: RATE_SOURCE_TEST_LIMIT, failClosed: true });

    const { code, config, date } = args;
    const body = testRateSourceBodySchema.parse({ rateSource: 'http', config, date });
    return testHttpRateSource({ userId, code, body });
  },
});
