import { type ResolveTrackerSuggestionsResponse, TRACKER_SUGGESTION_STATUS } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError } from '@js/errors';
import BudgetTransactions from '@models/budget-transactions.model';
import TrackerSuggestions from '@models/tracker-suggestions.model';
import { withTransaction } from '@services/common/with-transaction';

import { addTransactionsToBudget } from '../add-transactions-to-budget';
import { findOwnedTracker } from './find-owned-tracker';
import { acceptLinkedTransactions, trackSuggestionsResolved } from './suggestion-feedback';

export type ResolveSuggestionsAction = 'accept' | 'reject' | 'restore';

const RESOLVABLE_FROM: Record<ResolveSuggestionsAction, TRACKER_SUGGESTION_STATUS[]> = {
  accept: [TRACKER_SUGGESTION_STATUS.pending],
  reject: [TRACKER_SUGGESTION_STATUS.pending, TRACKER_SUGGESTION_STATUS.autoLinked, TRACKER_SUGGESTION_STATUS.accepted],
  restore: [TRACKER_SUGGESTION_STATUS.rejected],
};

export const resolveTrackerSuggestions = withTransaction(
  async ({
    userId,
    budgetId,
    suggestionIds,
    action,
  }: {
    userId: number;
    budgetId: string;
    suggestionIds: string[];
    action: ResolveSuggestionsAction;
  }): Promise<ResolveTrackerSuggestionsResponse> => {
    await findOwnedTracker({ userId, budgetId });

    const suggestions = await TrackerSuggestions.findAll({ where: { id: suggestionIds, budgetId }, lock: true });
    if (suggestions.length !== suggestionIds.length) {
      throw new NotFoundError({ message: t({ key: 'budgets.smartTracking.suggestionNotFound' }) });
    }

    const unresolvable = suggestions.find((suggestion) => !RESOLVABLE_FROM[action].includes(suggestion.status));
    if (unresolvable) {
      throw new ConflictError({
        message: t({
          key: 'budgets.smartTracking.suggestionAlreadyResolved',
          variables: { status: unresolvable.status },
        }),
      });
    }

    const transactionIds = suggestions.map((suggestion) => suggestion.transactionId);

    if (action === 'accept') {
      const linked = await BudgetTransactions.findAll({
        where: { budgetId, transactionId: transactionIds },
        attributes: ['transactionId'],
      });
      const linkedIds = new Set(linked.map((row) => row.transactionId));
      const unlinkedIds = transactionIds.filter((id) => !linkedIds.has(id));
      // Marks the suggestions accepted on its own, as it does for any manual link.
      if (unlinkedIds.length) await addTransactionsToBudget({ budgetId, userId, transactionIds: unlinkedIds });
      if (linkedIds.size) await acceptLinkedTransactions({ budgetId, transactionIds: [...linkedIds] });
    } else if (action === 'reject') {
      const linkedIds = suggestions
        .filter((suggestion) => suggestion.status !== TRACKER_SUGGESTION_STATUS.pending)
        .map((suggestion) => suggestion.transactionId);
      if (linkedIds.length) await BudgetTransactions.destroy({ where: { budgetId, transactionId: linkedIds } });
      await TrackerSuggestions.update(
        { status: TRACKER_SUGGESTION_STATUS.rejected, resolvedAt: new Date() },
        { where: { id: suggestionIds } },
      );
    } else {
      await TrackerSuggestions.update(
        { status: TRACKER_SUGGESTION_STATUS.pending, resolvedAt: null },
        { where: { id: suggestionIds } },
      );
    }

    trackSuggestionsResolved({ userId, action, suggestions });

    return { resolvedCount: suggestions.length };
  },
);
