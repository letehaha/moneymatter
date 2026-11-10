import type { SubscriptionCandidate } from '@/api/subscription-candidates';
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_UNITS,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { type QuickAddFormState, buildCandidatePrefill, buildQuickAddPayload } from './quick-add-payload';

const NOW = new Date(2025, 5, 15, 23, 45);

const buildForm = (overrides: Partial<QuickAddFormState> = {}): QuickAddFormState => ({
  name: 'Netflix',
  transactionType: TRANSACTION_TYPES.expense,
  type: SUBSCRIPTION_TYPES.subscription,
  expectedAmount: 9.99,
  expectedCurrencyCode: 'USD',
  frequency: SUBSCRIPTION_FREQUENCIES.monthly,
  intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
  intervalCount: null,
  nextPaymentDate: null,
  maxOccurrences: null,
  logo: null,
  accountId: null,
  ...overrides,
});

describe('buildQuickAddPayload', () => {
  it('sends the step with a custom frequency', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 30,
      }),
      now: NOW,
    });

    expect(payload).toMatchObject({
      frequency: SUBSCRIPTION_FREQUENCIES.custom,
      intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
      intervalCount: 30,
    });
  });

  it('leaves the step out for a preset, whatever the custom fields hold', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({ intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.week, intervalCount: 3 }),
      now: NOW,
    });

    expect(payload).not.toHaveProperty('intervalUnit');
    expect(payload).not.toHaveProperty('intervalCount');
  });

  it('builds a subscription payload', () => {
    const payload = buildQuickAddPayload({ form: buildForm(), now: NOW });

    expect(payload).toEqual({
      name: 'Netflix',
      type: SUBSCRIPTION_TYPES.subscription,
      transactionType: TRANSACTION_TYPES.expense,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: '2025-06-15',
      expectedAmount: 9.99,
      expectedCurrencyCode: 'USD',
      matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['Netflix'] }] },
    });
  });

  it('builds an amount-less bill payload', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({ type: SUBSCRIPTION_TYPES.bill, expectedAmount: null }),
      now: NOW,
    });

    expect(payload.type).toBe(SUBSCRIPTION_TYPES.bill);
    expect(payload).not.toHaveProperty('expectedAmount');
    expect(payload).not.toHaveProperty('expectedCurrencyCode');
  });

  it('builds an installment payload with its schedule and payment count', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({
        type: SUBSCRIPTION_TYPES.installment,
        nextPaymentDate: new Date(2025, 6, 1, 22, 30),
        maxOccurrences: 12,
      }),
      now: NOW,
    });

    expect(payload.type).toBe(SUBSCRIPTION_TYPES.installment);
    expect(payload.dueDate).toBe('2025-07-01');
    expect(payload.maxOccurrences).toBe(12);
  });

  it('omits maxOccurrences for non-installment kinds', () => {
    const payload = buildQuickAddPayload({ form: buildForm({ maxOccurrences: 12 }), now: NOW });

    expect(payload).not.toHaveProperty('maxOccurrences');
  });

  it('omits the currency when the amount is zero or missing', () => {
    expect(buildQuickAddPayload({ form: buildForm({ expectedAmount: 0 }), now: NOW })).not.toHaveProperty(
      'expectedCurrencyCode',
    );
    expect(buildQuickAddPayload({ form: buildForm({ expectedAmount: null }), now: NOW })).not.toHaveProperty(
      'expectedCurrencyCode',
    );
  });

  it('sends the amount only together with its currency', () => {
    const payload = buildQuickAddPayload({ form: buildForm({ expectedAmount: 12.5 }), now: NOW });

    expect(payload.expectedAmount).toBe(12.5);
    expect(payload.expectedCurrencyCode).toBe('USD');
  });

  it('formats dates in local time rather than UTC', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({ nextPaymentDate: new Date(2025, 11, 31, 23, 59) }),
      now: new Date(2025, 0, 1, 0, 30),
    });

    expect(payload.startDate).toBe('2025-01-01');
    expect(payload.dueDate).toBe('2025-12-31');
  });

  it('omits dueDate when no next payment date is set', () => {
    expect(buildQuickAddPayload({ form: buildForm(), now: NOW })).not.toHaveProperty('dueDate');
  });

  it('seeds a note matching rule from the trimmed name', () => {
    const payload = buildQuickAddPayload({ form: buildForm({ name: '  Spotify  ' }), now: NOW });

    expect(payload.name).toBe('Spotify');
    expect(payload.matchingRules).toEqual({
      rules: [{ field: 'note', operator: 'contains_any', value: ['Spotify'] }],
    });
  });

  it('never sends autoRecord, which would conflict with the seeded matching rule', () => {
    expect(buildQuickAddPayload({ form: buildForm(), now: NOW })).not.toHaveProperty('autoRecord');
  });

  it('sends a prefilled account and omits the key when there is none', () => {
    expect(buildQuickAddPayload({ form: buildForm({ accountId: 'acc-1' }), now: NOW }).accountId).toBe('acc-1');
    expect(buildQuickAddPayload({ form: buildForm(), now: NOW })).not.toHaveProperty('accountId');
  });

  it('includes a picked brand logo', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({ logo: { kind: 'brand', domain: 'netflix.com' } }),
      now: NOW,
    });

    expect(payload.logoDomain).toBe('netflix.com');
  });

  it('includes a picked monogram logo', () => {
    const payload = buildQuickAddPayload({
      form: buildForm({ logo: { kind: 'monogram', initials: 'NF', color: '#7355be' } }),
      now: NOW,
    });

    expect(payload.logoInitials).toBe('NF');
    expect(payload.logoColor).toBe('#7355be');
  });

  it('omits logo fields when nothing was picked', () => {
    const payload = buildQuickAddPayload({ form: buildForm(), now: NOW });

    expect(payload).not.toHaveProperty('logoDomain');
    expect(payload).not.toHaveProperty('logoInitials');
  });
});

describe('buildCandidatePrefill', () => {
  const candidate = {
    id: 'cand-1',
    suggestedName: 'MAGTI MOBILE',
    detectedFrequency: SUBSCRIPTION_FREQUENCIES.custom,
    detectedIntervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
    detectedIntervalCount: 30,
    averageAmount: 25,
    currencyCode: 'GEL',
    accountId: 'acc-1',
  } as SubscriptionCandidate;

  it('carries a detected custom step into the form', () => {
    expect(buildCandidatePrefill({ candidate })).toEqual({
      name: 'MAGTI MOBILE',
      expectedAmount: 25,
      expectedCurrencyCode: 'GEL',
      frequency: SUBSCRIPTION_FREQUENCIES.custom,
      intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
      intervalCount: 30,
      accountId: 'acc-1',
    });
  });

  it('prefills a detected preset without a step', () => {
    const prefill = buildCandidatePrefill({
      candidate: {
        ...candidate,
        detectedFrequency: SUBSCRIPTION_FREQUENCIES.monthly,
        detectedIntervalUnit: null,
        detectedIntervalCount: null,
        accountId: null,
      },
    });
    expect(prefill).toEqual({
      name: 'MAGTI MOBILE',
      expectedAmount: 25,
      expectedCurrencyCode: 'GEL',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      accountId: null,
    });
  });
});
