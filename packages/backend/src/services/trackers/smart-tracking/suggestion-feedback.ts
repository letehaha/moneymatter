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

/** A transaction the owner took out of a tracker is a "no" that neither AI nor rules may re-add. */
export const rejectUnlinkedTransactions = async ({
  userId,
  trackerId,
  transactionIds,
}: {
  userId: number;
  trackerId: string;
  transactionIds: string[];
}) => {
  if (!transactionIds.length) return;

  const resolvedAt = new Date();
  const existing = await TrackerSuggestions.findAll({ where: { trackerId, transactionId: transactionIds } });
  await TrackerSuggestions.update(
    { status: TRACKER_SUGGESTION_STATUS.rejected, resolvedAt },
    { where: { trackerId, transactionId: transactionIds } },
  );
  await TrackerSuggestions.bulkCreate(
    transactionIds.map((transactionId) => ({
      trackerId,
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
  trackerId,
  transactionIds,
}: {
  trackerId: string;
  transactionIds: string[];
}) => {
  await TrackerSuggestions.update(
    { status: TRACKER_SUGGESTION_STATUS.accepted, resolvedAt: new Date() },
    {
      where: {
        trackerId,
        transactionId: transactionIds,
        status: [TRACKER_SUGGESTION_STATUS.pending, TRACKER_SUGGESTION_STATUS.rejected],
      },
    },
  );
};
