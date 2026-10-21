import { currencyCode } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RATE_SOURCE_TEST_LIMIT } from '@services/common/user-rate-limits';
import { httpRateSourceConfigSchema, testRateSourceBodySchema } from '@services/currencies/rate-sources';
import { testHttpRateSource } from '@services/currencies/rate-sources/test-http-rate-source.service';
import { z } from 'zod';

import { enforceUserRateLimit, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = {
  code: currencyCode().describe('Code of the custom currency the source would price.'),
  config: httpRateSourceConfigSchema.describe(
    'The HTTP source to try: { urlTemplate, jsonPath, quoteCurrency?, headers? }. Omit headers to use the saved ones.',
  ),
  date: z.iso.date().optional().describe('The day to ask for (YYYY-MM-DD). Defaults to today.'),
};

export function validateTestCurrencyRateSourceArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { code, config, date } = args;
  return { code, body: testRateSourceBodySchema.parse({ rateSource: 'http', config, date }) };
}

export function registerTestCurrencyRateSource(server: McpServer) {
  server.registerTool(
    'test_currency_rate_source',
    {
      description:
        'Try an HTTP rate source for one day without saving anything: the server fetches the filled URL and reads the price at jsonPath. Returns { ok: true, date, rate, quoteCurrency }, or { ok: false, reason, message } when the request fails or the price is not found. Use it before set_currency_rate_source with an http source. Rate limited to 20 previews per minute.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await enforceUserRateLimit({ userId, limit: RATE_SOURCE_TEST_LIMIT });
      trackMcpToolUsed({ userId, tool: 'test_currency_rate_source', clientId: extra.authInfo?.clientId });

      const { code, body } = validateTestCurrencyRateSourceArgs({ args });
      const result = await testHttpRateSource({ userId, code, body });
      return jsonContent({ data: result });
    },
  );
}
