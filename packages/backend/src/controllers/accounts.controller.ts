import { ACCOUNT_TYPES } from '@bt/shared/types';
import { booleanQuery, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { Unauthorized } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { serializeAccount, serializeAccounts } from '@root/serializers';
import * as accountsService from '@services/accounts.service';
import { assertAccountUpdateAllowed } from '@services/accounts/assert-account-update-allowed';
import { refreshStaleVehicleValuesForUser } from '@services/vehicles/refresh-vehicle-value.service';
import { z } from 'zod';

import { createAccountBodySchema, updateAccountBodySchema } from './accounts/account-body.schema';
import { createController } from './helpers/controller-factory';

export const getAccounts = createController(z.object({}), async ({ user }) => {
  const { id: userId } = user;
  // Refresh vehicle balances whose 7-day cache has expired before reading the
  // accounts list. Errors per-vehicle are swallowed inside so one bad row never
  // breaks the response.
  await refreshStaleVehicleValuesForUser({ userId });
  const accounts = await accountsService.getAccounts({ userId });
  // Serialize: convert cents to decimal for API response
  return { data: serializeAccounts(accounts) };
});

export const getAccountById = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
  }),
  async ({ user, params }) => {
    const { id } = params;
    const { id: userId } = user;

    const account = await accountsService.getAccountById({ userId, id });
    // Serialize: convert cents to decimal for API response
    return { data: account ? serializeAccount(account) : null };
  },
);

export const createAccount = createController(
  z.object({
    body: createAccountBodySchema,
  }),
  async ({ user, body }) => {
    const {
      accountCategory,
      defaultPaymentType,
      currencyCode: currency,
      name,
      type,
      initialBalance,
      creditLimit,
      logoDomain,
      logoInitials,
      logoColor,
      logoIcon,
    } = body;
    const { id: userId } = user;

    if (type !== ACCOUNT_TYPES.system && process.env.NODE_ENV === 'production') {
      throw new Unauthorized({
        message: `Only "type: ${ACCOUNT_TYPES.system}" is allowed.`,
      });
    }

    // Convert decimal amounts to cents
    const account = await accountsService.createAccount({
      accountCategory,
      defaultPaymentType,
      currencyCode: currency,
      name,
      type,
      creditLimit: Money.fromDecimal(creditLimit),
      initialBalance: Money.fromDecimal(initialBalance),
      userId,
      logoDomain,
      logoInitials,
      logoColor,
      logoIcon,
    });

    // Serialize: convert cents to decimal for API response
    return { data: account ? serializeAccount(account) : null };
  },
);

export const updateAccount = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    body: updateAccountBodySchema,
  }),
  async ({ user, params, body }) => {
    const { id } = params;
    const { id: userId } = user;
    const {
      accountCategory,
      defaultPaymentType,
      name,
      creditLimit,
      status,
      excludeFromStats,
      currentBalance,
      initialBalance,
      logoDomain,
      logoInitials,
      logoColor,
      logoIcon,
    } = body;

    await assertAccountUpdateAllowed({ userId, id, accountCategory, currentBalance });

    // NOTE: the "currentBalance can't be set directly on a vehicle account"
    // guard lives in `accountsService.updateAccount` (not here) so every caller
    // — HTTP, MCP, internal — is covered, not just this controller.

    // Convert decimal amounts to cents
    const result = await accountsService.updateAccount({
      id,
      userId,
      // `removeUndefinedKeys` keeps nulls, so for the logo keys "absent = leave
      // untouched, null = clear" survives intact.
      ...removeUndefinedKeys({
        status,
        excludeFromStats,
        accountCategory,
        defaultPaymentType,
        currentBalance: currentBalance !== undefined ? Money.fromDecimal(currentBalance) : undefined,
        initialBalance: initialBalance !== undefined ? Money.fromDecimal(initialBalance) : undefined,
        name,
        creditLimit: creditLimit !== undefined ? Money.fromDecimal(creditLimit) : undefined,
        logoDomain,
        logoInitials,
        logoColor,
        logoIcon,
      }),
    });

    // Serialize: convert cents to decimal for API response
    return { data: result ? serializeAccount(result) : null };
  },
);

export const deleteAccount = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    query: z
      .object({
        removePortfolioTransfers: booleanQuery().optional(),
      })
      .optional(),
  }),
  async ({ user, params, query }) => {
    const { id } = params;
    const { id: userId } = user;
    await accountsService.deleteAccountById({
      id,
      userId,
      removePortfolioTransfers: query?.removePortfolioTransfers,
    });
  },
);
