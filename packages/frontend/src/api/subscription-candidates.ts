import { api } from '@/api/_api';
import { SUBSCRIPTION_CANDIDATE_STATUS, SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';

interface SubscriptionCandidatePossibleMatch {
  id: string;
  name: string;
}

export interface SubscriptionCandidate {
  id: string;
  suggestedName: string;
  detectedFrequency: SUBSCRIPTION_FREQUENCIES;
  /** Step of a `custom` detected frequency (e.g. every 30 days); null for a preset. */
  detectedIntervalUnit: SUBSCRIPTION_INTERVAL_UNITS | null;
  detectedIntervalCount: number | null;
  /** Average amount as decimal (already converted from cents) */
  averageAmount: number;
  currencyCode: string;
  accountId: string | null;
  sampleTransactionIds: string[];
  occurrenceCount: number;
  confidenceScore: number;
  medianIntervalDays: number;
  status: SUBSCRIPTION_CANDIDATE_STATUS;
  detectedAt: string;
  possibleMatch: SubscriptionCandidatePossibleMatch | null;
  isOutdated: boolean;
}

interface DetectCandidatesResponse {
  candidates: SubscriptionCandidate[];
  lastRunAt: string | null;
  isFromCache: boolean;
}

export const detectSubscriptionCandidates = async (): Promise<DetectCandidatesResponse> => {
  return api.get('/subscriptions/detect-candidates');
};

export const acceptSubscriptionCandidate = async ({
  id,
  subscriptionId,
}: {
  id: string;
  subscriptionId?: string;
}): Promise<{ id: string; status: string }> => {
  return api.post(`/subscriptions/candidates/${id}/accept`, subscriptionId ? { subscriptionId } : undefined);
};

export const dismissSubscriptionCandidate = async ({ id }: { id: string }): Promise<{ id: string; status: string }> => {
  return api.post(`/subscriptions/candidates/${id}/dismiss`);
};
