import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { createAccountBodyFields, createAccountBodySchema } from '@controllers/accounts/account-body.schema';
import { createAccount } from '@services/accounts.service';

import { defineTool } from '../define-tool';
import { presentAccount } from './account-output';

export const createAccountTool = defineTool({
  name: 'create_account',
  toolset: 'core',
  access: 'write',
  description: `Create a manual account. currencyCode is an ISO currency code. accountCategory defaults to "general"; defaultPaymentType (optional) is the payment type new transactions on the account start with; "${ACCOUNT_CATEGORIES.loan}" and "${ACCOUNT_CATEGORIES.vehicle}" are refused here (they have their own flows). initialBalance and creditLimit are decimals in the account currency. Give a logo as either logoDomain or logoInitials (+ logoColor), not both.`,
  input: createAccountBodyFields,
  validate: ({ args }) => createAccountBodySchema.parse(args),
  run: async ({
    userId,
    args: { accountCategory, defaultPaymentType, currencyCode, name, type, initialBalance, creditLimit, ...logo },
  }) => {
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

    return presentAccount({ account });
  },
});
