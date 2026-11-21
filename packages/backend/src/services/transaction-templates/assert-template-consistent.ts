import { ACCOUNT_STATUSES, ACCOUNT_TYPES, type RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';

/**
 * Validates the merged post-write state, so a partial update cannot leave an invalid row. Returns the
 * currency of the account it checked, which a pinned amount is denominated in.
 */
export const assertTemplateConsistent = async ({
  userId,
  amount,
  accountId,
  categoryId,
  payeeId,
  tagIds,
}: {
  userId: number;
  amount: Money | null;
  accountId: RecordId | null;
  categoryId: RecordId | null;
  payeeId: RecordId | null;
  tagIds: RecordId[];
}): Promise<{ accountCurrencyCode: string | null }> => {
  if (amount !== null && accountId == null) {
    throw new ValidationError({ message: t({ key: 'transactionTemplates.amountRequiresAccount' }) });
  }

  let accountCurrencyCode: string | null = null;
  if (accountId) {
    const account = await Accounts.findOne({
      where: { id: accountId, userId },
      attributes: ['id', 'type', 'status', 'currencyCode'],
    });
    if (!account) {
      throw new NotFoundError({ message: t({ key: 'transactionTemplates.accountNotFound' }) });
    }
    if (account.type !== ACCOUNT_TYPES.system) {
      throw new ValidationError({ message: t({ key: 'transactionTemplates.accountMustBeSystem' }) });
    }
    if (account.status !== ACCOUNT_STATUSES.active) {
      throw new ValidationError({ message: t({ key: 'transactionTemplates.accountArchived' }) });
    }
    accountCurrencyCode = account.currencyCode;
  }

  if (categoryId) {
    const category = await Categories.findOne({ where: { id: categoryId, userId }, attributes: ['id'] });
    if (!category) {
      throw new NotFoundError({ message: t({ key: 'transactionTemplates.categoryNotFound' }) });
    }
  }

  if (payeeId) {
    const payee = await Payees.findOne({ where: { id: payeeId, userId }, attributes: ['id'] });
    if (!payee) {
      throw new NotFoundError({ message: t({ key: 'transactionTemplates.payeeNotFound' }) });
    }
  }

  if (tagIds.length > 0) {
    const ownedCount = await Tags.count({ where: { id: tagIds, userId } });
    if (ownedCount !== tagIds.length) {
      throw new NotFoundError({ message: t({ key: 'transactionTemplates.tagsNotFound' }) });
    }
  }

  return { accountCurrencyCode };
};
