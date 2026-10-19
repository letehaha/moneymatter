import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import Properties from '@models/properties.model';
import { type FindOptions } from 'sequelize';

/**
 * Load a user's property by id, throwing NotFoundError when it does not exist or
 * belongs to another user. The `where` clause is fixed to scope by owner; extra
 * find options (e.g. `attributes` to narrow the columns loaded) pass through.
 */
export const findPropertyOrThrow = async ({
  propertyId,
  userId,
  ...options
}: { propertyId: string; userId: number } & Omit<FindOptions<Properties>, 'where'>) => {
  return findOrThrowNotFound({
    query: Properties.findOne({ where: { id: propertyId, userId }, ...options }),
    message: t({ key: 'properties.notFound' }),
  });
};

/**
 * Validate the optional mortgage link. A property may only point at a
 * loan-category account the same user owns; anything else is either a crafted
 * payload or a UI bug, and silently storing it would make the equity figure on
 * the detail page read off an unrelated balance.
 *
 * Passing `null` clears the link and skips validation.
 */
export const assertLinkableLoanAccount = async ({
  userId,
  loanAccountId,
}: {
  userId: number;
  loanAccountId: string | null | undefined;
}): Promise<void> => {
  if (!loanAccountId) return;

  const account = await Accounts.findOne({
    where: { id: loanAccountId, userId },
    attributes: ['id', 'accountCategory'],
  });

  if (!account) {
    throw new ValidationError({ message: t({ key: 'properties.loanAccountNotFound' }) });
  }

  if (account.accountCategory !== ACCOUNT_CATEGORIES.loan) {
    throw new ValidationError({ message: t({ key: 'properties.loanAccountNotALoan' }) });
  }
};
