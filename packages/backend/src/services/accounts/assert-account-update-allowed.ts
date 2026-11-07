import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, type RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';

/**
 * The checks a user-facing account update (the REST route and the MCP tool) makes before it
 * calls `updateAccount`. They live outside `updateAccount` itself because internal callers
 * legitimately write the balance of a bank-connected account (sync) and the category of a
 * vehicle or loan account (their own flows).
 *
 * Resolves the owner's account row, or throws not-found.
 */
export const assertAccountUpdateAllowed = async ({
  userId,
  id,
  accountCategory,
  currentBalance,
}: {
  userId: number;
  id: RecordId;
  accountCategory?: ACCOUNT_CATEGORIES;
  currentBalance?: number;
}): Promise<Accounts> => {
  const account = await findOrThrowNotFound({
    query: Accounts.findOne({ where: { id, userId } }),
    message: `Account with id "${id}" doesn't exist.`,
  });

  if (account.type !== ACCOUNT_TYPES.system && currentBalance !== undefined) {
    throw new ValidationError({
      message: `'currentBalance' is only allowed to be changed for "${ACCOUNT_TYPES.system}" account type`,
    });
  }

  // Flipping accountCategory into or out of 'vehicle' breaks the 1:1 Vehicles sidecar
  // invariant — the row would either point to a missing Vehicles record or strand an existing
  // one. Vehicle accounts are created/destroyed via the /vehicles endpoints which
  // create/cascade the sidecar; a generic update must not move accounts between categories
  // that own sidecars.
  if (accountCategory !== undefined && accountCategory !== account.accountCategory) {
    const involvesVehicle =
      accountCategory === ACCOUNT_CATEGORIES.vehicle || account.accountCategory === ACCOUNT_CATEGORIES.vehicle;
    if (involvesVehicle) {
      throw new ValidationError({
        message: `Changing accountCategory into or out of '${ACCOUNT_CATEGORIES.vehicle}' is not supported. Delete and recreate via /vehicles.`,
      });
    }
  }

  return account;
};
