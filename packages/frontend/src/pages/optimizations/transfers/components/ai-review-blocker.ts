type AiReviewBlocker = 'plan' | 'allowance' | 'setup';

/** Null while the feature status is still loading, so a remembered "on" isn't reset by a pending query. */
export const getAiReviewBlocker = ({
  servedBy,
  isPlanGated,
  isAllowanceReached,
}: {
  servedBy: 'connection' | 'server' | null | undefined;
  isPlanGated: boolean;
  isAllowanceReached: boolean;
}): AiReviewBlocker | null => {
  if (servedBy !== null) return null;
  if (isPlanGated) return 'plan';
  return isAllowanceReached ? 'allowance' : 'setup';
};
