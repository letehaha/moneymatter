import type { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import Subscriptions from '@models/subscriptions.model';

import { isFuzzyNameMatch } from './detect-candidates-utils';

interface PossibleMatch {
  id: string;
  name: string;
}

export interface SerializedCandidate {
  id: string;
  suggestedName: string;
  detectedFrequency: SUBSCRIPTION_FREQUENCIES;
  /** Step of a `custom` detected frequency (e.g. day × 30); null for a preset. */
  detectedIntervalUnit: SUBSCRIPTION_INTERVAL_UNITS | null;
  detectedIntervalCount: number | null;
  averageAmount: number;
  currencyCode: string;
  accountId: string | null;
  sampleTransactionIds: string[];
  occurrenceCount: number;
  confidenceScore: number;
  medianIntervalDays: number;
  status: string;
  detectedAt: Date;
  possibleMatch: PossibleMatch | null;
  isOutdated: boolean;
}

export function serializeCandidate({
  candidate,
  userSubscriptions,
}: {
  candidate: SubscriptionCandidates;
  userSubscriptions: Subscriptions[];
}): SerializedCandidate {
  const json = candidate.toJSON() as SubscriptionCandidates;

  let possibleMatch: PossibleMatch | null = null;
  for (const sub of userSubscriptions) {
    if (isFuzzyNameMatch({ a: json.suggestedName, b: sub.name })) {
      possibleMatch = { id: sub.id, name: sub.name };
      break;
    }
  }

  let isOutdated = false;
  if (json.lastOccurrenceAt && json.medianIntervalDays > 0) {
    const daysSinceLastOccurrence = (Date.now() - new Date(json.lastOccurrenceAt).getTime()) / (1000 * 60 * 60 * 24);
    isOutdated = daysSinceLastOccurrence > json.medianIntervalDays * 2;
  }

  return {
    id: json.id,
    suggestedName: json.suggestedName,
    detectedFrequency: json.detectedFrequency,
    detectedIntervalUnit: json.detectedIntervalUnit,
    detectedIntervalCount: json.detectedIntervalCount,
    averageAmount: Money.fromCents(json.averageAmount).toNumber(),
    currencyCode: json.currencyCode,
    accountId: json.accountId,
    sampleTransactionIds: json.sampleTransactionIds,
    occurrenceCount: json.occurrenceCount,
    confidenceScore: json.confidenceScore,
    medianIntervalDays: json.medianIntervalDays,
    status: json.status,
    detectedAt: json.detectedAt,
    possibleMatch,
    isOutdated,
  };
}
