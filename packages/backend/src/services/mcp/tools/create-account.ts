import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { createAccountBodyFields, createAccountBodySchema } from '@controllers/accounts/account-body.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAccount } from '@services/accounts.service';

import { presentAccount } from './account-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = createAccountBodyFields;

export function registerCreateAccount(server: McpServer) {
  server.registerTool(
    'create_account',
    {
      description: `Create a manual account. currencyCode is an ISO currency code. accountCategory defaults to "general"; defaultPaymentType (optional) is the payment type new transactions on the account start with; "${ACCOUNT_CATEGORIES.loan}" and "${ACCOUNT_CATEGORIES.vehicle}" are refused here (they have their own flows). initialBalance and creditLimit are decimals in the account currency. Give a logo as either logoDomain or logoInitials (+ logoColor), not both.`,
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_account', clientId: extra.authInfo?.clientId });

      const { accountCategory, defaultPaymentType, currencyCode, name, type, initialBalance, creditLimit, ...logo } =
        createAccountBodySchema.parse(args);

      const account = await createAccount({
        userId,
        accountCategory,
        defaultPaymentType,
        currencyCode,
        name,
        type,
        initialBalance: Money.fromDecimal(initialBalance),
        creditLimit: Money.fromDecimal(creditLimit),
        ...logo,
      });

      return jsonContent({ data: presentAccount({ account }) });
    },
  );
}
