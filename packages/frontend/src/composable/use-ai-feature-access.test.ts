import { AI_FEATURE, FEATURES, type Feature } from '@bt/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gated, userStore, invalidateQueries, addErrorNotification, captureException } = vi.hoisted(() => {
  const gatedFeatures = { list: [] as string[] };
  return {
    gated: gatedFeatures,
    userStore: {
      entitlements: { featureTrials: {} } as { featureTrials: Record<string, unknown> } | null,
      isReadOnly: false,
      isFeatureGated: (feature: string) => gatedFeatures.list.includes(feature),
      featureTrialDaysLeft: vi.fn(() => null as number | null),
      startFeatureTrial: vi.fn(),
    },
    invalidateQueries: vi.fn(),
    addErrorNotification: vi.fn(),
    captureException: vi.fn(),
  };
});

vi.mock('@/stores', () => ({ useUserStore: () => userStore }));
vi.mock('@tanstack/vue-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/notification-center', () => ({ useNotificationCenter: () => ({ addErrorNotification }) }));
vi.mock('@/lib/sentry', () => ({ captureException }));

import { useAiFeatureAccess } from './use-ai-feature-access';

const gate = ({ features = [] }: { features?: Feature[] } = {}) => {
  gated.list = features;
};

describe('useAiFeatureAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate();
    userStore.entitlements = { featureTrials: {} };
    userStore.isReadOnly = false;
  });

  it('maps tracker matching to the smart tracking entitlement and its day trial', () => {
    gate({ features: [FEATURES.smart_tracking] });
    const access = useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching });

    expect(access.isPlanGated.value).toBe(true);
    expect(access.trialDays).toBe(14);
    expect(access.isTrialAvailable.value).toBe(true);
  });

  it('offers no trial once one was started, on a read-only account, or when not gated', () => {
    gate({ features: [FEATURES.smart_tracking] });
    userStore.entitlements = { featureTrials: { [FEATURES.smart_tracking]: { endsAt: '2026-01-01' } } };
    const started = useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching });
    expect(started.hasTrialRecord.value).toBe(true);
    expect(started.isTrialAvailable.value).toBe(false);

    userStore.entitlements = { featureTrials: {} };
    userStore.isReadOnly = true;
    expect(useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching }).isTrialAvailable.value).toBe(false);

    userStore.isReadOnly = false;
    gate();
    expect(useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching }).isTrialAvailable.value).toBe(false);
  });

  it('falls back to operator_ai, which has no day trial', () => {
    gate({ features: [FEATURES.operator_ai] });
    const access = useAiFeatureAccess({ aiFeature: AI_FEATURE.categorization });

    expect(access.isPlanGated.value).toBe(true);
    expect(access.trialDays).toBeNull();
    expect(access.isTrialAvailable.value).toBe(false);
  });

  it('reports a failed trial start instead of throwing', async () => {
    gate({ features: [FEATURES.smart_tracking] });
    userStore.startFeatureTrial.mockRejectedValueOnce(new Error('boom'));
    const access = useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching });

    await expect(access.startTrial()).resolves.toBe(false);
    expect(captureException).toHaveBeenCalledOnce();
    expect(addErrorNotification).toHaveBeenCalledWith('billing.trialStartFailed');
    expect(access.isStartingTrial.value).toBe(false);
  });

  it('refreshes AI feature status after the trial starts', async () => {
    gate({ features: [FEATURES.smart_tracking] });
    userStore.startFeatureTrial.mockResolvedValueOnce(undefined);

    await expect(useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching }).startTrial()).resolves.toBe(true);
    expect(userStore.startFeatureTrial).toHaveBeenCalledWith({ feature: FEATURES.smart_tracking });
    expect(invalidateQueries).toHaveBeenCalledOnce();
  });
});
