import { AI_FEATURE, type AIAllowance, type AIFeatureStatus } from '@bt/shared/types';
import { format } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const aiAllowance = ref<AIAllowance | null>(null);
const featureStatuses = ref<Partial<Record<AI_FEATURE, Pick<AIFeatureStatus, 'usingUserKey'>>>>({});

vi.mock('@/composable/data-queries/ai-settings', () => ({
  useAiSettings: () => ({
    aiAllowance,
    getFeatureStatus: (feature: AI_FEATURE) => featureStatuses.value[feature],
  }),
}));

vi.mock('@/composable/use-date-locale', () => ({
  useDateLocale: () => ({ format }),
}));

import { useAiAllowance } from './use-ai-allowance';

const buildAllowance = (overrides: Partial<AIAllowance> = {}): AIAllowance => ({
  usedPercent: 0,
  state: 'ok',
  resetsAt: '2026-11-01T00:00:00.000Z',
  plan: 'trial',
  ...overrides,
});

describe('useAiAllowance', () => {
  beforeEach(() => {
    aiAllowance.value = null;
    featureStatuses.value = {};
  });

  it('exempts a feature served by the user key once the allowance is reached', () => {
    aiAllowance.value = buildAllowance({ state: 'reached', usedPercent: 100 });
    featureStatuses.value = { [AI_FEATURE.categorization]: { usingUserKey: true } };

    const { isReached, showBadge } = useAiAllowance();

    expect(isReached({ feature: AI_FEATURE.categorization })).toBe(false);
    expect(showBadge({ feature: AI_FEATURE.categorization })).toBe(false);
  });

  it('reports reached and shows the badge when no feature is given', () => {
    aiAllowance.value = buildAllowance({ state: 'reached', usedPercent: 100 });

    const { isReached, showBadge } = useAiAllowance();

    expect(isReached()).toBe(true);
    expect(showBadge()).toBe(true);
  });

  it('hides the badge while the allowance is ok', () => {
    aiAllowance.value = buildAllowance({ state: 'ok', usedPercent: 40 });

    expect(useAiAllowance().showBadge()).toBe(false);
  });

  it('formats the reset date as the UTC calendar day', () => {
    aiAllowance.value = buildAllowance({ resetsAt: '2026-11-01T00:00:00.000Z' });

    expect(useAiAllowance().resetDate.value).toBe('1 November');
  });

  it.each([
    [59, 'ok', 'ok'],
    [60, 'warning', 'warning'],
    [89, 'warning', 'warning'],
    [90, 'warning', 'danger'],
    [100, 'reached', 'danger'],
  ] as const)('grades %d%% (%s) as %s', (usedPercent, state, expected) => {
    aiAllowance.value = buildAllowance({ state, usedPercent });

    expect(useAiAllowance().tone.value).toBe(expected);
  });

  it('passes usedPercent through and defaults to 0 without an allowance', () => {
    const { usedPercent } = useAiAllowance();
    expect(usedPercent.value).toBe(0);

    aiAllowance.value = buildAllowance({ state: 'warning', usedPercent: 83 });
    expect(usedPercent.value).toBe(83);
  });
});
