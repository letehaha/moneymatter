<script setup lang="ts">
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import { Button } from '@/components/lib/ui/button';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/lib/ui/tooltip';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useEarliestTransactionDate } from '@/composable/data-queries/earliest-transaction-date';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useAiFeatureAccess } from '@/composable/use-ai-feature-access';
import type { Period } from '@/composable/use-period-navigation';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { AI_FEATURE } from '@bt/shared/types';
import { endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import {
  CalendarIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  LoaderCircleIcon,
  LockIcon,
  SearchIcon,
  SparklesIcon,
} from '@lucide/vue';
import { useLocalStorage } from '@vueuse/core';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { getAiReviewBlocker } from './ai-review-blocker';

const { t } = useI18n();

defineProps<{
  isLoading: boolean;
}>();

const period = defineModel<Period>('period', { required: true });
const includeOutOfWallet = defineModel<boolean>('includeOutOfWallet', { required: true });
const aiReview = defineModel<boolean>('aiReview', { required: true });

defineEmits<{
  scan: [];
}>();

const { earliestDate } = useEarliestTransactionDate();
const userStore = useUserStore();
const outOfWalletId = useId();
const aiReviewId = useId();

const { isPlanGated } = useAiFeatureAccess({ aiFeature: AI_FEATURE.transferMatching });
const { getFeatureStatus } = useAiSettings();
const { isReached, resetDate } = useAiAllowance();

const aiBlocker = computed(() =>
  getAiReviewBlocker({
    servedBy: getFeatureStatus(AI_FEATURE.transferMatching)?.servedBy,
    isPlanGated: isPlanGated.value,
    isAllowanceReached: isReached({ feature: AI_FEATURE.transferMatching }),
  }),
);

const blockerView = computed(() => {
  const toAiSettings = {
    ctaRoute: ROUTES_NAMES.settingsAi,
    ctaLabel: t('optimizations.transferSuggestions.aiReview.connectOwnModel'),
  };
  if (aiBlocker.value === 'plan') {
    return {
      pill: t('optimizations.transferSuggestions.aiReview.plusBadge'),
      pillClass: 'bg-primary/25 text-primary-text',
      ...(userStore.canSeeBilling
        ? { ctaRoute: ROUTES_NAMES.settingsPlanBilling, ctaLabel: t('billing.seePlans') }
        : toAiSettings),
    };
  }
  if (aiBlocker.value === 'allowance') {
    return {
      pill: t('optimizations.transferSuggestions.aiReview.blocked.allowance.pill', { date: resetDate.value }),
      pillClass: 'bg-warning-text/15 text-warning-text',
      ...toAiSettings,
    };
  }
  return {
    pill: t('optimizations.transferSuggestions.aiReview.blocked.setup.pill'),
    pillClass: 'bg-muted text-foreground',
    ctaRoute: ROUTES_NAMES.settingsAi,
    ctaLabel: t('optimizations.transferSuggestions.aiReview.openAiSettings'),
  };
});

const isNudgeSeen = useLocalStorage('optimizations:transfers:ai-review-nudge-seen', false);
const isNudgeDismissed = ref(isNudgeSeen.value);
const showNudge = computed(
  () => !isNudgeDismissed.value && !aiReview.value && Boolean(getFeatureStatus(AI_FEATURE.transferMatching)?.servedBy),
);

watch(
  aiBlocker,
  (blocker) => {
    if (blocker) aiReview.value = false;
  },
  { immediate: true },
);

const chipClass =
  'bg-secondary flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium';
const linkClass = 'text-primary-text underline-offset-2 hover:underline';

const quickPresets = computed<DateSelectorPreset[]>(() => [
  {
    label: t('optimizations.transferSuggestions.presets.last3Months'),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 2)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.last6Months'),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 5)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.lastYear'),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 11)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.thisYear'),
    getValue: () => ({
      from: startOfYear(new Date()),
      to: new Date(),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.previousYear'),
    getValue: () => {
      const prevYear = subYears(new Date(), 1);
      return {
        from: startOfYear(prevYear),
        to: endOfYear(prevYear),
      };
    },
  },
]);
</script>

<template>
  <div class="@container/scanbar border-b">
    <div class="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <DateSelector
        v-model="period"
        :presets="quickPresets"
        :earliest-date="earliestDate"
        popover-class-name="md:min-w-[600px]"
      >
        <template #trigger="{ triggerText }">
          <Button variant="outline" size="sm" class="font-semibold @max-2xl/scanbar:order-first">
            <CalendarIcon class="size-4" />
            {{ triggerText }}
            <ChevronDownIcon class="text-muted-foreground size-4" />
          </Button>
        </template>
      </DateSelector>

      <div class="bg-border mx-1 h-5 w-px @max-2xl/scanbar:hidden" aria-hidden="true" />

      <label :for="outOfWalletId" :class="chipClass">
        <Switch :id="outOfWalletId" v-model="includeOutOfWallet" />
        {{ $t('optimizations.transferSuggestions.outOfWalletSwitch') }}
      </label>

      <Popover v-if="aiBlocker">
        <PopoverTrigger as-child>
          <Button variant="secondary" size="sm" :class="cn(chipClass, 'text-muted-foreground hover:text-foreground')">
            <LockIcon class="size-4" />
            {{ $t('optimizations.transferSuggestions.aiReview.label') }}
            <span :class="cn('rounded px-1.5 py-0.5 text-xs font-bold', blockerView.pillClass)">
              {{ blockerView.pill }}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="grid w-80 gap-2 text-sm">
          <p class="font-semibold">{{ $t(`optimizations.transferSuggestions.aiReview.blocked.${aiBlocker}.title`) }}</p>
          <p class="text-muted-foreground">
            {{ $t(`optimizations.transferSuggestions.aiReview.blocked.${aiBlocker}.body`, { date: resetDate }) }}
          </p>
          <Button as-child size="sm" class="mt-1 justify-self-start">
            <RouterLink :to="{ name: blockerView.ctaRoute }">{{ blockerView.ctaLabel }}</RouterLink>
          </Button>
        </PopoverContent>
      </Popover>
      <TooltipProvider v-else>
        <Tooltip :open="showNudge">
          <TooltipTrigger as-child>
            <label
              :for="aiReviewId"
              :class="cn(chipClass, aiReview && 'border-primary/50 bg-primary/10')"
              @pointerenter="isNudgeSeen = true"
              @focusin="isNudgeSeen = true"
              @pointerleave="isNudgeDismissed = true"
              @focusout="isNudgeDismissed = true"
            >
              <Switch :id="aiReviewId" v-model="aiReview" />
              <SparklesIcon class="text-primary-text size-4" />
              {{ $t('optimizations.transferSuggestions.aiReview.label') }}
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="flex items-center gap-1.5">
            <SparklesIcon class="text-primary-text size-4 shrink-0" />
            {{ $t('optimizations.transferSuggestions.aiReview.nudge') }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AiUsageBadge v-if="!aiBlocker" :feature="AI_FEATURE.transferMatching" />

      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground rounded-full"
            :aria-label="$t('optimizations.transferSuggestions.aiReview.about')"
          >
            <CircleHelpIcon class="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="grid w-80 gap-2 text-sm">
          <p class="font-semibold">{{ $t('optimizations.transferSuggestions.aiReview.label') }}</p>
          <p class="text-muted-foreground">{{ $t('optimizations.transferSuggestions.aiReview.description') }}</p>
          <i18n-t keypath="optimizations.transferSuggestions.aiReview.cost" tag="p" class="text-muted-foreground">
            <template #link>
              <RouterLink :to="{ name: ROUTES_NAMES.settingsAi }" :class="linkClass">
                {{ $t('optimizations.transferSuggestions.aiReview.aiSettingsLink') }}
              </RouterLink>
            </template>
          </i18n-t>
        </PopoverContent>
      </Popover>

      <Button :disabled="isLoading" size="sm" class="ml-auto px-4 @max-2xl/scanbar:order-first" @click="$emit('scan')">
        <LoaderCircleIcon v-if="isLoading" class="size-4 animate-spin" />
        <SearchIcon v-else class="size-4" />
        {{ $t('common.actions.scan') }}
      </Button>
      <div class="hidden basis-full @max-2xl/scanbar:-order-1 @max-2xl/scanbar:block" aria-hidden="true" />
    </div>
  </div>
</template>
