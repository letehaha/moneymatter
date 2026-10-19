import { TRACKER_SUGGESTION_STATUS } from '@bt/shared/types';
import { trackEvent } from '@js/utils/posthog';
import TrackerSuggestions from '@models/tracker-suggestions.model';

export const trackSuggestionsResolved = ({
  userId,
  action,
  suggestions,
}: {
  userId: number;
  action: 'accept' | 'reject' | 'restore' | 'unlink';
  suggestions: Pick<TrackerSuggestions, 'status' | 'score'>[];
}) => {
  for (const suggestion of suggestions) {
    trackEvent({
      userId,
      event: 'tracker_suggestion_resolved',
      properties: { action, status_before: suggestion.status, score: suggestion.score },
    });
  }
};

/** A transaction the owner took out of a smart tracker is a "no" the AI must not ask about again. */
export const rejectUnlinkedTransactions = async ({
  userId,
  budgetId,
  transactionIds,
}: {
  userId: number;
  budgetId: string;
  transactionIds: string[];
}) => {
  if (!transactionIds.length) return;

  const resolvedAt = new Date();
  const existing = await TrackerSuggestions.findAll({ where: { budgetId, transactionId: transactionIds } });
  await TrackerSuggestions.update(
    { status: TRACKER_SUGGESTION_STATUS.rejected, resolvedAt },
    { where: { budgetId, transactionId: transactionIds } },
  );
  await TrackerSuggestions.bulkCreate(
    transactionIds.map((transactionId) => ({
      budgetId,
      transactionId,
      score: 0,
      reason: '',
      status: TRACKER_SUGGESTION_STATUS.rejected,
      resolvedAt,
    })),
    { ignoreDuplicates: true },
  );

  trackSuggestionsResolved({ userId, action: 'unlink', suggestions: existing });
};

/** A manual link answers any open or rejected suggestion for the same transaction. */
export const acceptLinkedTransactions = async ({
  budgetId,
  transactionIds,
}: {
  budgetId: string;
  transactionIds: string[];
}) => {
  await TrackerSuggestions.update(
    { status: TRACKER_SUGGESTION_STATUS.accepted, resolvedAt: new Date() },
    {
      where: {
        budgetId,
        transactionId: transactionIds,
        status: [TRACKER_SUGGESTION_STATUS.pending, TRACKER_SUGGESTION_STATUS.rejected],
      },
    },
  );
};
