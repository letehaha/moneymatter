<script setup lang="ts">
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useAiFeatureAccess } from '@/composable/use-ai-feature-access';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { AI_FEATURE, type BudgetModel, type TrackerSuggestionsResponse } from '@bt/shared/types';
import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, SparklesIcon } from '@lucide/vue';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { getSmartTrackingStripState } from './smart-tracking-state';
import SmartTrackingReview from './smart-tracking-review.vue';

const props = defineProps<{
  budget: BudgetModel;
  suggestions: TrackerSuggestionsResponse | undefined;
}>();
const emit = defineEmits<{ openSettings: [] }>();
const reviewOpen = defineModel<boolean>('reviewOpen', { default: false });

const { t } = useI18n();
const { format, formatRelative } = useDateLocale();
const { resetDate } = useAiAllowance();
const { data: userSettings, patch: patchUserSettings } = useUserSettings();
const queryClient = useQueryClient();
const { isTrialAvailable, startTrial, isStartingTrial } = useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching });

const startTrialForTracker = async () => {
  if (await startTrial()) void queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetSuggestions });
};

const tipStorageKey = computed(() => `smart-tracking-tip-hidden:${props.budget.id}`);
const readTipHiddenHere = () => {
  try {
    return localStorage.getItem(tipStorageKey.value) === '1';
  } catch {
    return false;
  }
};
const isTipHiddenHere = ref(readTipHiddenHere());

const state = computed(() =>
  getSmartTrackingStripState({
    aiEnabled: props.budget.aiEnabled,
    tipHidden: isTipHiddenHere.value || !!userSettings.value?.hideSmartTrackingTip,
    suggestions: props.suggestions,
  }),
);

watch(state, (next, previous) => {
  if (previous === 'review' && next !== 'review') reviewOpen.value = false;
});

const pendingCount = computed(() => props.suggestions?.pending.length ?? 0);
const checkedLabel = computed(() => {
  const lastScannedAt = props.suggestions?.scan.lastScannedAt;
  return lastScannedAt
    ? t('budgets.smartTracking.strip.checkedAt', {
        when: formatRelative(new Date(lastScannedAt), new Date()),
      })
    : null;
});
const startedLabel = computed(() => {
  const startedAt = props.suggestions?.scan.startedAt;
  return startedAt
    ? t('budgets.smartTracking.strip.startedAt', {
        time: format(startedAt, 'HH:mm'),
      })
    : null;
});

const PAUSED_COPY = {
  pausedAllowance: {
    badgeKey: 'budgets.smartTracking.pausedUntil',
    textKey: 'budgets.smartTracking.strip.allowanceUsed',
    actionKey: 'budgets.smartTracking.connectOwnModel',
  },
  pausedUnavailable: {
    badgeKey: 'budgets.smartTracking.strip.paused',
    textKey: 'budgets.smartTracking.strip.unavailable',
    actionKey: 'budgets.smartTracking.strip.fixInSettings',
  },
} as const;
const pausedCopy = computed(() =>
  state.value === 'pausedAllowance' || state.value === 'pausedUnavailable' ? PAUSED_COPY[state.value] : null,
);

const MUTED_TEXT_KEYS = {
  idle: 'budgets.smartTracking.strip.idle',
  ended: 'budgets.smartTracking.strip.ended',
  noStartDate: 'budgets.smartTracking.strip.noStartDate',
} as const;
const mutedTextKey = computed(() =>
  state.value === 'idle' || state.value === 'ended' || state.value === 'noStartDate'
    ? MUTED_TEXT_KEYS[state.value]
    : null,
);

const isHideTipOpen = ref(false);
const neverShowTip = ref(false);
const hideTip = () => {
  try {
    localStorage.setItem(tipStorageKey.value, '1');
  } catch {
    // Storage can be blocked; the tip then hides for this visit only.
  }
  isTipHiddenHere.value = true;
  if (neverShowTip.value) patchUserSettings({ hideSmartTrackingTip: true });
  isHideTipOpen.value = false;
};
</script>

<template>
  <div v-if="state !== 'hidden'" class="border-b">
    <div class="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm @md/tracker-tx:px-4">
      <Loader2Icon
        v-if="state === 'scanning'"
        class="text-primary-text size-4 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <SparklesIcon
        v-else
        :class="
          cn('size-4 shrink-0', state === 'tip' || state === 'review' ? 'text-primary-text' : 'text-muted-foreground')
        "
      />

      <template v-if="state === 'tip'">
        <span class="min-w-0 flex-1">{{ $t('budgets.smartTracking.strip.tip') }}</span>
        <div class="flex gap-1">
          <Button size="sm" variant="soft-primary" @click="emit('openSettings')">
            {{ $t('budgets.smartTracking.strip.turnOn') }}
          </Button>
          <Button size="sm" variant="secondary" @click="isHideTipOpen = true">
            {{ $t('budgets.smartTracking.strip.hide') }}
          </Button>
        </div>
      </template>

      <span v-else-if="state === 'scanning'" class="min-w-0 flex-1">
        {{ $t('budgets.smartTracking.strip.scanning') }}
        <span v-if="startedLabel" class="text-muted-foreground"> · {{ startedLabel }}</span>
      </span>

      <template v-else-if="state === 'review'">
        <span class="min-w-0 flex-1">
          <span class="font-semibold">{{ $t('budgets.smartTracking.strip.toReview', { count: pendingCount }) }}</span>
          <span v-if="checkedLabel" class="text-muted-foreground"> · {{ checkedLabel }}</span>
        </span>
        <Button size="sm" variant="secondary" :aria-expanded="reviewOpen" @click="reviewOpen = !reviewOpen">
          {{ reviewOpen ? $t('budgets.smartTracking.strip.hide') : $t('budgets.smartTracking.strip.review') }}
          <component :is="reviewOpen ? ChevronUpIcon : ChevronDownIcon" class="size-4" />
        </Button>
      </template>

      <template v-else-if="state === 'pausedPlan'">
        <StatusBadge variant="warning">{{ $t('budgets.smartTracking.strip.paused') }}</StatusBadge>
        <span class="text-muted-foreground min-w-0 flex-1">{{ $t('budgets.smartTracking.plan.locked') }}</span>
        <div class="flex flex-wrap gap-1">
          <Button v-if="isTrialAvailable" size="sm" :disabled="isStartingTrial" @click="startTrialForTracker">
            {{ $t('budgets.smartTracking.plan.startTrial') }}
          </Button>
          <Button size="sm" :variant="isTrialAvailable ? 'secondary' : 'soft-primary'" as-child>
            <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">
              {{ $t('budgets.smartTracking.plan.upgrade') }}
            </RouterLink>
          </Button>
          <Button size="sm" variant="ghost" as-child>
            <RouterLink :to="{ name: ROUTES_NAMES.settingsAi }">
              {{ $t('budgets.smartTracking.plan.connectOwnKey') }}
            </RouterLink>
          </Button>
        </div>
      </template>

      <template v-else-if="pausedCopy">
        <StatusBadge variant="warning">{{ $t(pausedCopy.badgeKey, { date: resetDate }) }}</StatusBadge>
        <span class="text-muted-foreground min-w-0 flex-1">{{ $t(pausedCopy.textKey) }}</span>
        <Button size="sm" variant="ghost" as-child>
          <RouterLink :to="{ name: ROUTES_NAMES.settingsAi }">{{ $t(pausedCopy.actionKey) }}</RouterLink>
        </Button>
      </template>

      <template v-else-if="mutedTextKey">
        <span class="text-muted-foreground min-w-0 flex-1">
          {{ $t(mutedTextKey) }}<template v-if="state === 'idle' && checkedLabel"> · {{ checkedLabel }}</template>
        </span>
        <Button v-if="state !== 'ended'" size="sm" variant="secondary" @click="emit('openSettings')">
          {{ $t('budgets.smartTracking.strip.settings') }}
        </Button>
      </template>
    </div>

    <SmartTrackingReview
      v-if="state === 'review' && reviewOpen && suggestions"
      :budget="budget"
      :pending="suggestions.pending"
    />

    <ResponsiveAlertDialog
      v-model:open="isHideTipOpen"
      :confirm-label="$t('budgets.smartTracking.hideTip.confirm')"
      @confirm="hideTip"
    >
      <template #title>{{ $t('budgets.smartTracking.hideTip.title') }}</template>
      <template #description>{{ $t('budgets.smartTracking.hideTip.description') }}</template>
      <label class="flex cursor-pointer items-start gap-2 text-left">
        <Checkbox v-model="neverShowTip" class="mt-0.5" />
        <span class="grid gap-0.5">
          <span class="text-sm font-medium">{{ $t('budgets.smartTracking.hideTip.neverShow') }}</span>
          <span class="text-muted-foreground text-xs">{{ $t('budgets.smartTracking.hideTip.neverShowHint') }}</span>
        </span>
      </label>
    </ResponsiveAlertDialog>
  </div>
</template>
