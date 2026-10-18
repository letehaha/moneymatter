import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startBaseCurrencyChange } from '@services/currencies/start-base-currency-change.service';
import { getUserBaseCurrency, setBaseUserCurrency } from '@services/user.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  newCurrencyCode: isoCurrencyCode().describe('ISO 4217 code of the new base currency, such as "USD".'),
};

export function registerChangeBaseCurrency(server: McpServer) {
  server.registerTool(
    'change_base_currency',
    {
      description:
        'Set the base (reporting) currency. For a user with none yet it sets it at once and returns the currency row. For a user who has one it starts a background change and returns { jobId, state }: the change recalculates the whole history in the new currency and blocks every other edit until it finishes, so call it only when the user asked for it. Poll get_base_currency_change_status for the outcome. Only ISO currencies with historical rates are accepted (see list_supported_currencies).',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });

      // The two branches follow two REST routes with different guards, so the branch is resolved first.
      const baseCurrency = await getUserBaseCurrency({ userId });

      if (!baseCurrency) {
        // POST /user/currencies/base: a read-only user may set the first base (onboarding), and the route
        // carries the base-currency lock.
        requireScope({ extra, scope: 'finance:write', allowReadOnly: true });
        await assertBaseCurrencyUnlocked({ userId });
        trackMcpToolUsed({ userId, tool: 'change_base_currency', clientId: extra.authInfo?.clientId });

        const result = await setBaseUserCurrency({ userId, currencyCode: args.newCurrencyCode });
        return jsonContent({ data: result });
      }

      // POST /user/currencies/change-base: not a read-only route, and it has no lock check because the
      // enqueue takes the lock itself and answers a second change with the proper refusal.
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'change_base_currency', clientId: extra.authInfo?.clientId });

      const job = await startBaseCurrencyChange({ userId, newCurrencyCode: args.newCurrencyCode });
      return jsonContent({ data: { jobId: job.jobId, state: job.state } });
    },
  );
}
