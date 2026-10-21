import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { previewAutomation } from '@services/transaction-automations/preview';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent } from './helpers';
import { automationConditionsInput } from './transaction-automation-inputs';

const inputSchema = {
  conditions: automationConditionsInput,
};

export function registerPreviewTransactionAutomation(server: McpServer) {
  server.registerTool(
    'preview_transaction_automation',
    {
      description:
        'Dry-run a set of automation conditions against up to the last 1000 eligible existing transactions and return { matchedCount, scannedCount, matches } where matches is capped at 5 sample transactions. Nothing is modified. Use it to sanity-check conditions before create_transaction_automation or update_transaction_automation. Note that a live automation fires on its own only for newly synced or imported bank transactions that are not transfers and not planned; existing transactions change only when the user runs "Apply to past transactions" for a saved rule in the app.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      // POST /automations/preview carries the base-currency lock in REST, though it only reads.
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'preview_transaction_automation', clientId: extra.authInfo?.clientId });

      const result = await previewAutomation({ userId, conditions: args.conditions });

      return jsonContent({ data: result });
    },
  );
}
