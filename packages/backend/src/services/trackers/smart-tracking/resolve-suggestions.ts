import { type ResolveTrackerSuggestionsResponse, TRACKER_SUGGESTION_STATUS } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError } from '@js/errors';
import TrackerSuggestions from '@models/tracker-suggestions.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import { withTransaction } from '@services/common/with-transaction';
import partition from 'lodash/partition';
import { Transaction } from 'sequelize';

import { addTransactionsToTracker } from '../add-transactions-to-tracker';
import { syncTrackerRules } from '../rules/sync-tracker-rules';
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
    trackerId,
    suggestionIds,
    action,
  }: {
    userId: number;
    trackerId: string;
    suggestionIds: string[];
    action: ResolveSuggestionsAction;
  }): Promise<ResolveTrackerSuggestionsResponse> => {
    await findOwnedTracker({ userId, trackerId });
    // Tracker row before suggestion rows, the same order syncTrackerRules takes them in.
    await Trackers.findByPk(trackerId, { attributes: ['id'], lock: Transaction.LOCK.NO_KEY_UPDATE });

    const suggestions = await TrackerSuggestions.findAll({
      where: { id: suggestionIds, trackerId },
      lock: true,
    });
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
      const linked = await TrackerTransactions.findAll({
        where: { trackerId, transactionId: transactionIds },
        attributes: ['transactionId'],
      });
      const linkedIds = new Set(linked.map((row) => row.transactionId));
      const unlinkedIds = transactionIds.filter((id) => !linkedIds.has(id));
      // Marks the suggestions accepted on its own, as it does for any manual link.
      if (unlinkedIds.length) await addTransactionsToTracker({ trackerId, userId, transactionIds: unlinkedIds });
      if (linkedIds.size) await acceptLinkedTransactions({ trackerId, transactionIds: [...linkedIds] });
    } else if (action === 'reject') {
      const linkedIds = suggestions
        .filter((suggestion) => suggestion.status !== TRACKER_SUGGESTION_STATUS.pending)
        .map((suggestion) => suggestion.transactionId);
      if (linkedIds.length) await TrackerTransactions.destroy({ where: { trackerId, transactionId: linkedIds } });
      await TrackerSuggestions.update(
        { status: TRACKER_SUGGESTION_STATUS.rejected, resolvedAt: new Date() },
        { where: { id: suggestionIds } },
      );
    } else {
      // Score 0 rows record a hand removal, not an AI verdict: dropping them lets rules and AI consider the transaction again.
      const [scored, removed] = partition(suggestions, (suggestion) => suggestion.score > 0);
      if (scored.length) {
        await TrackerSuggestions.update(
          { status: TRACKER_SUGGESTION_STATUS.pending, resolvedAt: null },
          { where: { id: scored.map((suggestion) => suggestion.id) } },
        );
      }
      if (removed.length) {
        await TrackerSuggestions.destroy({ where: { id: removed.map((suggestion) => suggestion.id) } });
      }
      await syncTrackerRules({ trackerId });
    }

    trackSuggestionsResolved({ userId, action, suggestions });

    return { resolvedCount: suggestions.length };
  },
);
