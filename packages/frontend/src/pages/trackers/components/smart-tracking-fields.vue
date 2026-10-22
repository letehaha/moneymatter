<script setup lang="ts">
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { Switch } from '@/components/lib/ui/switch';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useAiFeatureAccess } from '@/composable/use-ai-feature-access';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  AI_FEATURE,
  TRACKER_AI_DESCRIPTION_MAX_LENGTH,
  TRACKER_AI_PRE_WINDOW_DAYS,
  type TrackerAiPreWindowDays,
} from '@bt/shared/types';
import { Loader2Icon, SparklesIcon } from '@lucide/vue';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { type SmartTrackingValues, isSmartTrackingIncomplete } from '../build-tracker-payload';

const props = defineProps<{
  hasStartDate: boolean;
  isStoredOn?: boolean;
  isScanning?: boolean;
  showErrors?: boolean;
}>();
const model = defineModel<SmartTrackingValues>({ required: true });

const PRE_WINDOW_LABEL_KEYS: Record<TrackerAiPreWindowDays, string> = {
  0: 'budgets.smartTracking.fields.preWindowOptions.none',
  14: 'budgets.smartTracking.fields.preWindowOptions.twoWeeks',
  30: 'budgets.smartTracking.fields.preWindowOptions.oneMonth',
  60: 'budgets.smartTracking.fields.preWindowOptions.twoMonths',
  90: 'budgets.smartTracking.fields.preWindowOptions.threeMonths',
  180: 'budgets.smartTracking.fields.preWindowOptions.sixMonths',
};

const { t } = useI18n();
const switchId = useId();
const { getFeatureStatus } = useAiSettings();
const { isReached, resetDate } = useAiAllowance();

const queryClient = useQueryClient();
const { isPlanGated, hasTrialRecord, isTrialAvailable, trialDaysLeft, trialDays, startTrial, isStartingTrial } =
  useAiFeatureAccess({ aiFeature: AI_FEATURE.trackerMatching });

const featureStatus = computed(() => getFeatureStatus(AI_FEATURE.trackerMatching));
const isAllowanceReached = computed(() => !isPlanGated.value && isReached({ feature: AI_FEATURE.trackerMatching }));
const needsTrialStart = computed(() => isTrialAvailable.value && props.isStoredOn);
const isPlanLocked = computed(
  () => isPlanGated.value && hasTrialRecord.value && featureStatus.value?.servedBy === null,
);
// A gated user has no server model until the trial starts, which is not a missing AI setup.
const isAiMissing = computed(
  () => !isPlanGated.value && !isAllowanceReached.value && featureStatus.value?.servedBy === null,
);
const canTurnOn = computed(() => props.hasStartDate && !isAiMissing.value && !isPlanLocked.value);
const isSwitchDisabled = computed(() => props.isScanning || (!model.value.aiEnabled && !canTurnOn.value));

const preWindowOptions = computed(() =>
  TRACKER_AI_PRE_WINDOW_DAYS.map((days) => ({
    value: days,
    label: t(PRE_WINDOW_LABEL_KEYS[days]),
  })),
);
const selectedPreWindow = computed(
  () => preWindowOptions.value.find((option) => option.value === model.value.aiPreWindowDays) ?? null,
);

const descriptionError = computed(() =>
  props.showErrors && isSmartTrackingIncomplete({ values: model.value })
    ? t('budgets.smartTracking.fields.descriptionRequired')
    : undefined,
);

watch(
  () => props.hasStartDate,
  (hasStartDate) => {
    if (!hasStartDate) model.value.aiEnabled = false;
  },
);

const startTrialForTracker = async () => {
  if (await startTrial()) void queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.trackerSuggestions });
};

const linkClass = 'text-primary-text underline-offset-2 hover:underline';
</script>

<template>
  <div class="grid gap-3 border-t pt-4">
    <div class="text-primary-text flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
      <SparklesIcon class="size-3.5" />
      {{ $t('budgets.smartTracking.fields.heading') }}
      <StatusBadge v-if="isAllowanceReached" variant="warning" class="tracking-normal normal-case">
        {{ $t('budgets.smartTracking.pausedUntil', { date: resetDate }) }}
      </StatusBadge>
    </div>

    <div class="flex items-start justify-between gap-4">
      <div class="grid gap-0.5">
        <Label :for="switchId">{{ $t('budgets.smartTracking.fields.switchLabel') }}</Label>
        <p v-if="isScanning" class="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Loader2Icon class="text-primary-text mt-0.5 size-3 shrink-0 animate-spin motion-reduce:animate-none" />
          {{ $t('budgets.smartTracking.fields.running') }}
        </p>
        <p v-else-if="isAllowanceReached" class="text-muted-foreground text-xs">
          <i18n-t keypath="budgets.smartTracking.fields.allowanceUsed" tag="span">
            <template #link>
              <RouterLink :to="{ name: ROUTES_NAMES.settingsAi }" :class="linkClass">
                {{ $t('budgets.smartTracking.connectOwnModel') }}
              </RouterLink>
            </template>
          </i18n-t>
        </p>
        <p v-else-if="!model.aiEnabled && isAiMissing" class="text-muted-foreground text-xs">
          <i18n-t keypath="budgets.smartTracking.fields.noAi" tag="span">
            <template #link>
              <RouterLink :to="{ name: ROUTES_NAMES.settingsAi }" :class="linkClass">
                {{ $t('budgets.smartTracking.fields.noAiLink') }}
              </RouterLink>
            </template>
          </i18n-t>
        </p>
        <p v-else-if="!model.aiEnabled && !hasStartDate" class="text-muted-foreground text-xs">
          {{ $t('budgets.smartTracking.fields.needsStartDate') }}
        </p>
        <p v-else class="text-muted-foreground text-xs">
          {{ $t('budgets.smartTracking.fields.switchHint') }}
        </p>
      </div>
      <Switch :id="switchId" v-model="model.aiEnabled" :disabled="isSwitchDisabled" />
    </div>

    <Callout v-if="isPlanLocked || needsTrialStart" variant="primary">
      <div class="grid gap-1">
        <span>{{ $t('budgets.smartTracking.plan.locked') }}</span>
        <div class="flex flex-wrap gap-x-3">
          <Button
            v-if="needsTrialStart"
            variant="link"
            size="sm"
            class="h-auto p-0"
            :disabled="isStartingTrial"
            @click="startTrialForTracker"
          >
            {{ $t('budgets.smartTracking.plan.startTrial') }}
          </Button>
          <Button as-child variant="link" size="sm" class="h-auto p-0">
            <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">{{ $t('billing.seePlans') }}</RouterLink>
          </Button>
          <Button as-child variant="link" size="sm" class="h-auto p-0">
            <RouterLink :to="{ name: ROUTES_NAMES.settingsAi }">
              {{ $t('budgets.smartTracking.plan.connectOwnKey') }}
            </RouterLink>
          </Button>
        </div>
      </div>
    </Callout>
    <p v-else-if="trialDaysLeft !== null" class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
      {{ $t('budgets.smartTracking.plan.trialDaysLeft', trialDaysLeft) }}
      <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }" :class="linkClass">
        {{ $t('billing.seePlans') }}
      </RouterLink>
    </p>
    <p v-else-if="isTrialAvailable" class="text-muted-foreground text-xs">
      {{ $t('budgets.smartTracking.plan.trialHint', { days: trialDays }) }}
    </p>

    <template v-if="model.aiEnabled">
      <TextareaField
        :model-value="model.aiDescription ?? ''"
        :label="$t('budgets.smartTracking.fields.descriptionLabel')"
        :placeholder="$t('budgets.smartTracking.fields.descriptionPlaceholder')"
        :maxlength="TRACKER_AI_DESCRIPTION_MAX_LENGTH"
        :disabled="isScanning"
        :error-message="descriptionError"
        @update:model-value="(value) => (model.aiDescription = String(value))"
      />

      <div class="grid gap-1.5">
        <SelectField
          :model-value="selectedPreWindow"
          :values="preWindowOptions"
          :label="$t('budgets.smartTracking.fields.preWindowLabel')"
          :placeholder="$t('budgets.smartTracking.fields.preWindowPlaceholder')"
          :disabled="isScanning"
          @update:model-value="(option) => option && (model.aiPreWindowDays = option.value)"
        />
        <p class="text-muted-foreground text-xs">
          {{ $t('budgets.smartTracking.fields.preWindowHint') }}
        </p>
      </div>

      <p class="text-muted-foreground text-xs">{{ $t('budgets.smartTracking.fields.costNote') }}</p>

      <p
        v-if="featureStatus?.servedBy"
        class="text-muted-foreground flex items-start gap-1.5 border-t border-dashed pt-3 text-xs"
      >
        <SparklesIcon class="mt-0.5 size-3 shrink-0" />
        {{
          featureStatus.servedBy === 'connection'
            ? $t('budgets.smartTracking.fields.usesOwnModel', {
                model: featureStatus.modelName,
              })
            : $t('budgets.smartTracking.fields.usesIncluded')
        }}
      </p>
    </template>
  </div>
</template>
