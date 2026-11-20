import type { FireSettings, FireSettingsSnapshot } from '@bt/shared/types';
import { type MaybeRefOrGetter, type Ref, computed, toValue } from 'vue';

import type { FirePlan } from './build-fire-plan';
import { anchorFireSettings, comparePace, fireSettingsAt, resolvePaceAnchor } from './fire-pace';
import { useFirePlan, useResolvedFireSettings } from './use-fire-plan';

/** Recomputes the plan as of the pace anchor, with the settings recorded for that month, and compares it to `plan`. */
export const useFirePace = ({
  plan,
  fire,
  history,
  enabled = true,
}: {
  plan: Ref<FirePlan>;
  fire: MaybeRefOrGetter<FireSettings | undefined>;
  history: MaybeRefOrGetter<FireSettingsSnapshot[] | undefined>;
  enabled?: MaybeRefOrGetter<boolean>;
}) => {
  const now = new Date();
  // Waits for the current plan so the anchor's requests don't compete with the ones the page is waiting on.
  const isAnchorEnabled = computed(() => toValue(enabled) && plan.value.status !== 'loading');
  const anchor = computed(() => resolvePaceAnchor({ paceAnchor: toValue(fire)?.paceAnchor, now }));

  const {
    settings: anchorSettings,
    isLoading: isSettingsLoading,
    isError: isSettingsError,
    refetch: refetchSettings,
  } = useResolvedFireSettings({
    fire: () => anchorFireSettings({ history: toValue(history), current: toValue(fire), month: anchor.value.month }),
    enabled: isAnchorEnabled,
    asOf: () => anchor.value.date,
  });
  const {
    plan: anchorPlan,
    isSettled,
    isError: isPlanError,
    refetch: refetchPlan,
  } = useFirePlan({
    settings: anchorSettings,
    includeHistory: false,
    enabled: isAnchorEnabled,
    now: () => anchor.value.date,
  });

  const isError = computed(() => isSettingsError.value || isPlanError.value);
  const isAnchorReady = computed(() => isSettled.value && !isSettingsLoading.value);
  const isComparable = computed(
    () => toValue(enabled) && (plan.value.status === 'ready' || plan.value.status === 'unreachable'),
  );
  const isLoading = computed(() => isComparable.value && !isError.value && !isAnchorReady.value);

  const pace = computed(() =>
    isError.value || !isAnchorReady.value
      ? null
      : comparePace({
          current: plan.value,
          anchorPlan: anchorPlan.value,
          anchor: anchor.value,
          anchorInflationPct: anchorSettings.value.effectiveInflationPct,
          usesRecordedSettings: fireSettingsAt({ history: toValue(history), month: anchor.value.month }) !== null,
          now,
        }),
  );

  const retry = () => {
    refetchPlan();
    refetchSettings();
  };

  return { pace, anchor, isLoading, isError: computed(() => isComparable.value && isError.value), retry };
};
