<template>
  <div class="@container/fire">
    <Teleport defer :to="`#${ANALYTICS_HEADER_ACTIONS_ID}`">
      <!-- Rendered while settings load so the header doesn't reflow once they arrive. -->
      <Button
        v-if="canAddToDashboard"
        size="sm"
        variant="outline"
        :class="cn(!userSettings && 'invisible')"
        :disabled="!userSettings || isAddingWidget"
        @click="addToDashboard"
      >
        <LayoutDashboardIcon class="size-4" />
        {{ $t('analytics.fire.addToDashboard') }}
      </Button>
    </Teleport>

    <PlanRestricted
      v-if="!isStartingTrial"
      :feature="FEATURES.fire_planner"
      overlay
      :hint="
        userStore.entitlements?.featureTrials[FEATURES.fire_planner] ? $t('analytics.fire.trial.ended') : undefined
      "
    >
      <div class="grid grid-cols-1 gap-4 @4xl/fire:grid-cols-[minmax(0,1fr)_20rem] @4xl/fire:items-start">
        <div class="flex min-w-0 flex-col gap-4">
          <Callout v-if="trialDaysLeft !== null" variant="info">
            {{ $t('analytics.fire.trial.daysLeft', trialDaysLeft) }}
            <Button as-child variant="link" size="sm" class="h-auto p-0">
              <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">{{ $t('billing.seePlans') }}</RouterLink>
            </Button>
          </Callout>

          <FireSkeleton v-if="isLoading" />

          <Callout v-else-if="hasError" variant="warning">
            {{ $t('analytics.fire.loadFailed') }}
            <Button variant="link" size="sm" class="h-auto p-0" @click="retry">
              {{ $t('common.actions.retry') }}
            </Button>
          </Callout>

          <section
            v-else-if="plan.status === 'no-data' || plan.status === 'needs-spending'"
            class="border-border bg-card rounded-lg border"
          >
            <FireEmptyState
              :status="plan.status"
              :months-used="plan.inputs.seed.monthsUsed"
              @enter-spending="focusField({ field: 'spending' })"
            />
          </section>

          <template v-else>
            <section class="border-border bg-card flex flex-col gap-6 rounded-lg border p-4 @2xl/fire:p-6">
              <FireHero
                :plan="plan"
                :settings="settings"
                :target-name="targetName"
                @focus-field="focusField({ field: $event })"
                @toggle-source="onDraftChange({ next: { ...draft, [$event]: !settings[$event] } })"
              />
              <Callout v-for="callout in callouts" :key="callout.key" :variant="callout.variant">
                <div class="flex items-start gap-2">
                  <span class="flex-1">
                    {{ callout.text }}
                    <Button
                      v-if="callout.key === 'contribution-clamped'"
                      variant="link"
                      size="sm"
                      class="h-auto p-0"
                      @click="focusField({ field: 'contribution' })"
                    >
                      {{ $t('analytics.fire.callouts.enterContribution') }}
                    </Button>
                  </span>
                  <DesktopOnlyTooltip v-if="callout.dismissible" :content="$t('analytics.fire.callouts.hide')">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="-my-1.5 -mr-1.5 size-7"
                      :aria-label="$t('analytics.fire.callouts.hide')"
                      @click="calloutToHide = callout.key"
                    >
                      <XIcon class="size-4" />
                    </Button>
                  </DesktopOnlyTooltip>
                </div>
              </Callout>
              <ResponsiveAlertDialog
                :open="calloutToHide !== null"
                :confirm-label="$t('analytics.fire.callouts.hideConfirm')"
                @update:open="!$event && closeHideDialog()"
                @confirm="hideCallout"
              >
                <template #title>{{ $t('analytics.fire.callouts.hideTitle') }}</template>
                <template #description>{{ $t('analytics.fire.callouts.hideDescription') }}</template>
                <label v-if="calloutToHide === PERSISTABLE_CALLOUT" class="flex cursor-pointer items-center gap-2">
                  <Checkbox v-model="dontShowCalloutAgain" />
                  <span class="text-sm">{{ $t('analytics.fire.callouts.dontShowAgain') }}</span>
                </label>
              </ResponsiveAlertDialog>
              <FireProgress :plan="plan" :target-name="targetName" />
              <FireTypeChips
                :plan="plan"
                :settings="settings"
                @focus-field="focusField({ field: $event })"
                @select-target="onDraftChange({ next: { ...draft, targetType: $event } })"
              />
            </section>

            <section
              v-if="plan.chart"
              class="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 @2xl/fire:p-6"
            >
              <FireChart
                v-if="plan.chart.projection.length > 1 || plan.chart.history.length > 0"
                :chart="plan.chart"
                :target-name="targetName"
              />
              <FireMilestones :milestones="plan.milestones" :target-name="targetName" />
            </section>

            <p class="text-muted-foreground px-1 text-xs">{{ $t('analytics.fire.disclaimer') }}</p>
          </template>
        </div>

        <!-- Sticky only moves within the grid area, so side by side the panel itself must be the grid item. -->
        <div class="flex flex-col gap-3 @4xl/fire:contents">
          <Button
            variant="secondary"
            class="w-full justify-between @4xl/fire:hidden"
            :aria-expanded="isAssumptionsOpen"
            @click="isAssumptionsOpen = !isAssumptionsOpen"
          >
            {{ $t('analytics.fire.adjustAssumptions') }}
            <ChevronDownIcon :class="cn('size-4 transition-transform', isAssumptionsOpen && 'rotate-180')" />
          </Button>

          <!-- Only the side-by-side layout pins the panel, so only there does it need its own scroll. -->
          <SidePanel
            :class="cn(!isAssumptionsOpen && 'hidden', '@4xl/fire:block')"
            viewport-class="@max-4xl/fire:max-h-none"
          >
            <FireAssumptionsSkeleton v-if="isLoading && !hasLoaded" />
            <FireAssumptions
              v-else-if="userSettings"
              ref="assumptions"
              :model-value="draft"
              :plan="plan"
              :settings="settings"
              @update:model-value="onDraftChange({ next: $event })"
            />
          </SidePanel>
        </div>
      </div>
    </PlanRestricted>
  </div>
</template>

<script setup lang="ts">
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { SidePanel } from '@/components/lib/ui/side-panel';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { FIRE_WIDGET_ID, WIDGET_REGISTRY } from '@/components/widgets/widget-registry';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import type { FireWarning } from '@/composable/fire/build-fire-plan';
import { useFirePlan, useResolvedFireSettings } from '@/composable/fire/use-fire-plan';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { useDashboardLayout } from '@/pages/dashboard/composables/use-dashboard-layout';
import { ANALYTICS_HEADER_ACTIONS_ID } from '@/pages/analytics/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { FEATURES, type FireSettings } from '@bt/shared/types';
import { ChevronDownIcon, LayoutDashboardIcon, XIcon } from '@lucide/vue';
import { useDebounceFn, useLocalStorage } from '@vueuse/core';
import { cloneDeep, isEqual, pick } from 'lodash-es';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';

import FireAssumptionsSkeleton from './components/fire-assumptions-skeleton.vue';
import FireAssumptions, { type FireFocusField } from './components/fire-assumptions.vue';
import FireChart from './components/fire-chart.vue';
import FireEmptyState from './components/fire-empty-state.vue';
import FireHero from './components/fire-hero.vue';
import FireMilestones from './components/fire-milestones.vue';
import FireProgress from './components/fire-progress.vue';
import FireSkeleton from './components/fire-skeleton.vue';
import FireTypeChips from './components/fire-type-chips.vue';

const PERSIST_DEBOUNCE_MS = 800;
const SAVE_FAILED_TOAST_ID = 'fire-save-failed';
const TRIAL_FAILED_TOAST_ID = 'fire-trial-failed';
const DAYS_PER_YEAR = 365;
const INFO_WARNINGS: FireWarning[] = ['history-degraded', 'portfolio-unavailable', 'custom-missing'];
const PERSISTABLE_CALLOUT: FireWarning = 'history-degraded';
const WARNING_KEYS: Record<FireWarning, string> = {
  'contribution-clamped': 'analytics.fire.callouts.contributionClamped',
  'return-below-inflation': 'analytics.fire.callouts.returnBelowInflation',
  'portfolio-short-history': 'analytics.fire.callouts.portfolioShortHistory',
  'portfolio-unavailable': 'analytics.fire.callouts.portfolioUnavailable',
  'custom-missing': 'analytics.fire.callouts.customMissing',
  'history-degraded': 'analytics.fire.callouts.historyDegraded',
};

const { t } = useI18n();
const { addNotification, removeNotification, addSuccessNotification, addErrorNotification } = useNotificationCenter();
const {
  data: userSettings,
  isLoading: isUserSettingsLoading,
  isError: isUserSettingsError,
  refetch: refetchUserSettings,
  patchAsync,
} = useUserSettings();

const userStore = useUserStore();
const isGated = computed(() => userStore.isFeatureGated(FEATURES.fire_planner));
const trialDaysLeft = computed(() => userStore.featureTrialDaysLeft({ feature: FEATURES.fire_planner }));

const isStartingTrial = ref(false);
const needsTrial = computed(
  () => isGated.value && !userStore.isReadOnly && !userStore.entitlements?.featureTrials[FEATURES.fire_planner],
);
const startTrial = async () => {
  if (!needsTrial.value || isStartingTrial.value) return;
  isStartingTrial.value = true;
  try {
    await userStore.startFeatureTrial({ feature: FEATURES.fire_planner });
  } catch (error) {
    captureException({ error, context: { scope: 'fire:start-trial' } });
    addNotification({
      id: TRIAL_FAILED_TOAST_ID,
      text: t('analytics.fire.trial.startFailed'),
      type: NotificationType.error,
      action: {
        label: t('common.actions.retry'),
        onClick: () => {
          removeNotification(TRIAL_FAILED_TOAST_ID);
          startTrial();
        },
      },
    });
  } finally {
    isStartingTrial.value = false;
  }
};
watch(needsTrial, startTrial, { immediate: true });

const draft = ref<FireSettings>({});
const hasUserEdits = ref(false);
const changedFields = new Set<keyof FireSettings>();

watch(
  () => userSettings.value?.fire,
  (fire) => {
    if (hasUserEdits.value) return;
    draft.value = cloneDeep(fire ?? {});
  },
  { immediate: true },
);

// Only edited fields are sent, so a stale draft can't revert fields changed elsewhere (e.g. another tab).
const sendPatch = async () => {
  if (changedFields.size === 0 || isGated.value || !userSettings.value) return;
  const fields = [...changedFields];
  changedFields.clear();
  try {
    await patchAsync({ fire: pick(draft.value, fields) });
  } catch (error) {
    for (const field of fields) changedFields.add(field);
    throw error;
  }
  for (const field of fields) trackAnalyticsEvent({ event: 'fire_assumption_changed', properties: { field } });
};
// Each save waits for the previous one, so an older PATCH can't land after a newer one.
let lastSave: Promise<void> = Promise.resolve();
const persist = () => {
  lastSave = lastSave.catch(() => undefined).then(sendPatch);
  return lastSave;
};
const flush = (): Promise<void> =>
  persist().then(
    () => {
      if (changedFields.size === 0) removeNotification(SAVE_FAILED_TOAST_ID);
    },
    (error) => {
      captureException({ error, context: { scope: 'fire:save-settings' } });
      addNotification({
        id: SAVE_FAILED_TOAST_ID,
        text: t('analytics.fire.saveFailed'),
        type: NotificationType.error,
        persistent: true,
        action: {
          label: t('common.actions.retry'),
          onClick: () => {
            // Sonner's action click skips onDismiss, so the id is released here before a retry can re-raise it.
            removeNotification(SAVE_FAILED_TOAST_ID);
            flush();
          },
        },
      });
    },
  );
const persistDebounced = useDebounceFn(flush, PERSIST_DEBOUNCE_MS);

const onDraftChange = ({ next }: { next: FireSettings }) => {
  const keys = new Set([...Object.keys(draft.value), ...Object.keys(next)]) as Set<keyof FireSettings>;
  for (const field of keys) {
    if (!isEqual(draft.value[field], next[field])) changedFields.add(field);
  }
  draft.value = next;
  hasUserEdits.value = true;
  persistDebounced();
};

onBeforeUnmount(flush);

const {
  settings,
  isLoading: isSettingsLoading,
  isError: isSettingsError,
  refetch: refetchSettings,
} = useResolvedFireSettings({ fire: () => draft.value });
const { plan, isError: isPlanError, refetch: refetchPlan } = useFirePlan({ settings, includeHistory: true });
const targetName = computed(() => t(`common.fire.targets.${settings.value.targetType}`));

const hasError = computed(() => isPlanError.value || isSettingsError.value || isUserSettingsError.value);
const retry = () => {
  refetchPlan();
  refetchSettings();
  if (isUserSettingsError.value) refetchUserSettings();
};

const isLoading = computed(
  () => plan.value.status === 'loading' || isUserSettingsLoading.value || isSettingsLoading.value,
);
const hasLoaded = ref(false);
watchEffect(() => {
  if (!isLoading.value) hasLoaded.value = true;
});

const hiddenCallouts = useLocalStorage<FireWarning[]>('fire:hidden-callouts', []);
const sessionHiddenCallouts = ref<FireWarning[]>([]);
const calloutToHide = ref<FireWarning | null>(null);
const dontShowCalloutAgain = ref(false);
const closeHideDialog = () => {
  calloutToHide.value = null;
  dontShowCalloutAgain.value = false;
};
const hideCallout = () => {
  if (calloutToHide.value === null) return;
  const persistent = dontShowCalloutAgain.value && calloutToHide.value === PERSISTABLE_CALLOUT;
  const target = persistent ? hiddenCallouts : sessionHiddenCallouts;
  target.value = [...target.value, calloutToHide.value];
  closeHideDialog();
};

const callouts = computed(() =>
  plan.value.warnings
    .filter((key) => !hiddenCallouts.value.includes(key) && !sessionHiddenCallouts.value.includes(key))
    .map((key) => ({
      key,
      dismissible: INFO_WARNINGS.includes(key),
      variant: INFO_WARNINGS.includes(key) ? ('info' as const) : ('warning' as const),
      text: t(WARNING_KEYS[key], {
        real: `${Number((settings.value.realAnnual * 100).toFixed(1))}%`,
        years: Number(((settings.value.returnPeriodDays ?? 0) / DAYS_PER_YEAR).toFixed(1)),
      }),
    })),
);

const isAssumptionsOpen = ref(false);
const assumptionsRef = useTemplateRef<InstanceType<typeof FireAssumptions>>('assumptions');

const focusField = async ({ field }: { field: FireFocusField }) => {
  isAssumptionsOpen.value = true;
  await nextTick();
  assumptionsRef.value?.focusField({ field });
};

const { activeWidgets } = useDashboardLayout();
const isAddingWidget = ref(false);
const canAddToDashboard = computed(
  () => !isGated.value && !activeWidgets.value.some((w) => w.widgetId === FIRE_WIDGET_ID),
);

const addToDashboard = async () => {
  isAddingWidget.value = true;
  await flush();
  try {
    const def = WIDGET_REGISTRY[FIRE_WIDGET_ID]!;
    await patchAsync({
      dashboard: {
        widgets: [
          ...activeWidgets.value,
          { widgetId: FIRE_WIDGET_ID, colSpan: def.defaultColSpan, rowSpan: def.defaultRowSpan },
        ],
      },
    });
    trackAnalyticsEvent({ event: 'fire_widget_added' });
    addSuccessNotification(t('analytics.fire.addedToDashboard'));
  } catch (error) {
    captureException({ error, context: { scope: 'fire:add-to-dashboard' } });
    addErrorNotification(t('analytics.fire.addToDashboardFailed'));
  } finally {
    isAddingWidget.value = false;
  }
};

onMounted(() => trackAnalyticsEvent({ event: 'fire_page_viewed' }));
</script>
