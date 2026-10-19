import { TRACKER_AI_LIKELY_SCORE, type TrackerScanStatus, type TrackerSuggestionsResponse } from '@bt/shared/types';

type SmartTrackingStripState =
  | 'hidden'
  | 'tip'
  | 'scanning'
  | 'review'
  | 'pausedPlan'
  | 'pausedAllowance'
  | 'pausedUnavailable'
  | 'ended'
  | 'noStartDate'
  | 'idle';

export const isScanActive = ({ status }: { status: TrackerScanStatus | undefined }) =>
  status === 'queued' || status === 'running';

export const getSmartTrackingStripState = ({
  aiEnabled,
  tipHidden,
  suggestions,
}: {
  aiEnabled: boolean;
  tipHidden: boolean;
  suggestions: Pick<TrackerSuggestionsResponse, 'pending' | 'scan'> | undefined;
}): SmartTrackingStripState => {
  if (!aiEnabled) return tipHidden ? 'hidden' : 'tip';
  if (!suggestions || suggestions.scan.pausedReason === 'archived') return 'hidden';
  if (isScanActive({ status: suggestions.scan.status })) return 'scanning';
  // Reviewing what is already found needs no AI, so it wins over a paused scan.
  if (suggestions.pending.length > 0) return 'review';

  switch (suggestions.scan.pausedReason) {
    case 'plan':
      return 'pausedPlan';
    case 'allowance':
      return 'pausedAllowance';
    case 'unavailable':
      return 'pausedUnavailable';
    case 'ended':
      return 'ended';
    case 'no_start_date':
      return 'noStartDate';
    default:
      return 'idle';
  }
};

export const getSuggestionConfidence = ({ score }: { score: number }): 'likely' | 'possible' =>
  score >= TRACKER_AI_LIKELY_SCORE ? 'likely' : 'possible';
