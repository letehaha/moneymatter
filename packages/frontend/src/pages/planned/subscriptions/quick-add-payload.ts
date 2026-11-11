import type { SubscriptionCandidate } from '@/api/subscription-candidates';
import type { createSubscription } from '@/api/subscriptions';
import { type LogoSelection, toLogoPayload } from '@/components/common/logo-selection';
import {
  SUBSCRIPTION_FREQUENCIES,
  type SUBSCRIPTION_INTERVAL_UNITS,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { format } from 'date-fns';

export interface QuickAddFormState {
  name: string;
  transactionType: TRANSACTION_TYPES;
  type: SUBSCRIPTION_TYPES;
  expectedAmount: number | null;
  expectedCurrencyCode: string;
  frequency: SUBSCRIPTION_FREQUENCIES;
  /** Step of a custom frequency; ignored for the presets. */
  intervalUnit: SUBSCRIPTION_INTERVAL_UNITS;
  intervalCount: number | null;
  nextPaymentDate: Date | null;
  maxOccurrences: number | null;
  logo: LogoSelection | null;
  /** Not rendered by the dialog; carried by prefill flows (e.g. a discovered candidate's account). */
  accountId: string | null;
}

type QuickAddPayload = Parameters<typeof createSubscription>[0];

const API_DATE_FORMAT = 'yyyy-MM-dd';

/**
 * Builds the create-subscription payload for the quick-add dialog. Everything the
 * dialog does not ask for is left to the backend defaults so the detail page can
 * refine it afterwards.
 */
export const buildQuickAddPayload = ({ form, now }: { form: QuickAddFormState; now: Date }): QuickAddPayload => {
  const name = form.name.trim();
  const amount = form.expectedAmount;
  const hasAmount = amount !== null && amount > 0;

  return {
    name,
    type: form.type,
    transactionType: form.transactionType,
    frequency: form.frequency,
    ...(form.frequency === SUBSCRIPTION_FREQUENCIES.custom
      ? { intervalUnit: form.intervalUnit, intervalCount: form.intervalCount }
      : {}),
    startDate: format(now, API_DATE_FORMAT),
    ...(form.nextPaymentDate ? { dueDate: format(form.nextPaymentDate, API_DATE_FORMAT) } : {}),
    // The API rejects an amount without its currency and a currency without its
    // amount, so the pair is either both present or both absent.
    ...(hasAmount ? { expectedAmount: amount, expectedCurrencyCode: form.expectedCurrencyCode } : {}),
    ...(form.type === SUBSCRIPTION_TYPES.installment && form.maxOccurrences
      ? { maxOccurrences: form.maxOccurrences }
      : {}),
    ...(form.accountId ? { accountId: form.accountId as QuickAddPayload['accountId'] } : {}),
    // Seeded so a later bank import links to this subscription without extra setup.
    // autoRecord stays off (its default): the API rejects it alongside matching rules.
    matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: [name] }] },
    ...(form.logo ? toLogoPayload({ selection: form.logo }) : {}),
  };
};

/** Seeds the quick-add form from a discovered candidate, its detected custom step included. */
export const buildCandidatePrefill = ({
  candidate,
}: {
  candidate: SubscriptionCandidate;
}): Partial<QuickAddFormState> => ({
  name: candidate.suggestedName,
  expectedAmount: candidate.averageAmount,
  expectedCurrencyCode: candidate.currencyCode,
  frequency: candidate.detectedFrequency,
  ...(candidate.detectedIntervalUnit && candidate.detectedIntervalCount
    ? { intervalUnit: candidate.detectedIntervalUnit, intervalCount: candidate.detectedIntervalCount }
    : {}),
  accountId: candidate.accountId,
});
