import { BUDGET_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetTransactions, { BudgetTransactionMetadata } from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import { findTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { authorizeBudgetAccess } from './authorize-budget-access';
import { acceptLinkedTransactions } from './smart-tracking/suggestion-feedback';

interface AddTransactionsPayload {
  budgetId: string;
  userId: number;
  transactionIds: string[];
}

export const addTransactionsToBudget = withTransaction(async (payload: AddTransactionsPayload) => {
  const { budgetId, userId, transactionIds } = payload;

  // `write` permission lets recipients attach their own transactions; manage/owner pass
  // through unchanged. Recipients without `write` (i.e. `read`) get a 404 here.
  const { ownerUserId, isOwner } = await authorizeBudgetAccess({
    userId,
    budgetId,
    requiredPermission: SHARE_PERMISSIONS.write,
  });

  const budget = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id: budgetId, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  // Category budgets auto-track transactions by category - manual linking is not allowed
  if (budget.type === BUDGET_TYPES.category) {
    throw new ValidationError({ message: t({ key: 'budgets.cannotManuallyLinkToCategoryBudget' }) });
  }

  // Recipients can only attach THEIR OWN transactions to a shared manual budget. Owners
  // can attach anything they own. The transaction's category does NOT need to match the
  // budget's category list (per "Category mismatch on attach" decision — category list
  // governs auto-include, not manual attachment).
  const txOwnerUserId = isOwner ? ownerUserId : userId;
  // Plans are attachable on purpose: owners track their own planned spend in manual
  // budgets; recipients never see them via stats scoping.
  const transactions = await findTransactions({
    planned: 'include',
    access: { creator: txOwnerUserId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { id: { [Op.in]: transactionIds } },
    attributes: ['id'],
  });

  if (transactions.length !== transactionIds.length) {
    throw new ValidationError({ message: t({ key: 'budgets.someTransactionIdsInvalid' }) });
  }

  // Stamp `addedByUserId` on recipient-attached rows so the share-revocation sweep and
  // the detach-permission check can identify rows the recipient owns. Owner-attached
  // rows leave `metadata` null — interpreted as "owner-attached" downstream.
  const metadata: BudgetTransactionMetadata | null = isOwner ? null : { addedByUserId: userId };
  const budgetTransactions = transactionIds.map((transactionId) => ({
    budgetId,
    transactionId,
    metadata,
  }));

  await BudgetTransactions.bulkCreate(budgetTransactions);
  await acceptLinkedTransactions({ budgetId, transactionIds });

  return {
    message: t({ key: 'budgets.transactionsAddedSuccessfully' }),
  };
});
