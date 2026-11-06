import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { updateAccountBodyFields, updateAccountBodySchema } from '@controllers/accounts/account-body.schema';
import { removeUndefinedKeys } from '@js/helpers';
import { updateAccount } from '@services/accounts.service';
import { assertAccountUpdateAllowed } from '@services/accounts/assert-account-update-allowed';

import { defineTool } from '../define-tool';
import { presentAccount } from './account-output';

export const updateAccountTool = defineTool({
  name: 'update_account',
  toolset: 'core',
  access: 'write',
  description:
    'Update an account: name, accountCategory, defaultPaymentType (null clears it), creditLimit, excludeFromStats, logo, and balances. currentBalance is allowed only on manual (system) accounts and moves the opening balance by the difference; initialBalance and currentBalance cannot be sent together. An account cannot be moved into or out of the vehicle category, or into loan. Amounts are decimals. Archiving is not done here: use archive_account.',
  input: {
    accountId: recordId().describe('ID of the account to update.'),
    ...updateAccountBodyFields,
  },
  run: async ({ userId, args }) => {
    const { accountId, ...body } = args;
    const {
      accountCategory,
      defaultPaymentType,
      name,
      creditLimit,
      excludeFromStats,
      currentBalance,
      initialBalance,
      ...logo
    } = updateAccountBodySchema.parse(body);

    await assertAccountUpdateAllowed({ userId, id: accountId, accountCategory, currentBalance });

    const account = await updateAccount({
      id: accountId,
      userId,
      // `removeUndefinedKeys` keeps nulls, so for the logo keys "absent = leave untouched,
      // null = clear" survives intact.
      ...removeUndefinedKeys({
        excludeFromStats,
        accountCategory,
        defaultPaymentType,
        currentBalance: currentBalance !== undefined ? Money.fromDecimal(currentBalance) : undefined,
        initialBalance: initialBalance !== undefined ? Money.fromDecimal(initialBalance) : undefined,
        name,
        creditLimit: creditLimit !== undefined ? Money.fromDecimal(creditLimit) : undefined,
        ...logo,
      }),
    });

    return presentAccount({ account });
  },
});
