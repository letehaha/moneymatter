import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { updateAccountBodyFields, updateAccountBodySchema } from '@controllers/accounts/account-body.schema';
import { removeUndefinedKeys } from '@js/helpers';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateAccount } from '@services/accounts.service';
import { assertAccountUpdateAllowed } from '@services/accounts/assert-account-update-allowed';

import { presentAccount } from './account-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = {
  accountId: recordId().describe('ID of the account to update.'),
  ...updateAccountBodyFields,
};

export function validateUpdateAccountArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { accountId, ...body } = args;
  return { accountId, ...updateAccountBodySchema.parse(body) };
}

export function registerUpdateAccount(server: McpServer) {
  server.registerTool(
    'update_account',
    {
      description:
        'Update an account: name, accountCategory, creditLimit, excludeFromStats, logo, and balances. currentBalance is allowed only on manual (system) accounts and moves the opening balance by the difference; initialBalance and currentBalance cannot be sent together. An account cannot be moved into or out of the vehicle category, or into loan. Amounts are decimals. Archiving is not done here: use archive_account.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_account', clientId: extra.authInfo?.clientId });

      const {
        accountId,
        accountCategory,
        name,
        creditLimit,
        excludeFromStats,
        currentBalance,
        initialBalance,
        ...logo
      } = validateUpdateAccountArgs({ args });

      await assertAccountUpdateAllowed({ userId, id: accountId, accountCategory, currentBalance });

      const account = await updateAccount({
        id: accountId,
        userId,
        // `removeUndefinedKeys` keeps nulls, so for the logo keys "absent = leave untouched,
        // null = clear" survives intact.
        ...removeUndefinedKeys({
          excludeFromStats,
          accountCategory,
          currentBalance: currentBalance !== undefined ? Money.fromDecimal(currentBalance) : undefined,
          initialBalance: initialBalance !== undefined ? Money.fromDecimal(initialBalance) : undefined,
          name,
          creditLimit: creditLimit !== undefined ? Money.fromDecimal(creditLimit) : undefined,
          ...logo,
        }),
      });

      return jsonContent({ data: await presentAccount({ account }) });
    },
  );
}
