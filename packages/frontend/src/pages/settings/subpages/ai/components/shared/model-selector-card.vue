<template>
  <Collapsible v-slot="{ open }" class="@container/feature-header rounded-lg border">
    <div class="flex items-center">
      <CollapsibleTrigger class="flex min-w-0 flex-1 items-center gap-3 p-4 text-left">
        <ChevronRightIcon class="size-4 shrink-0 transition-transform" :class="{ 'rotate-90': open }" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <component :is="displayInfo.icon" class="text-muted-foreground size-4 shrink-0" />
            <h4 class="font-medium">{{ $t(displayInfo.nameKey) }}</h4>
            <!-- Stops the tap from also toggling the card -->
            <span v-if="featureStatus.servedBy" class="inline-flex" @click.stop>
              <ApiKeySourceBadge :using-user-key="featureStatus.usingUserKey" />
            </span>
            <span v-if="!open && fitWarningKey" :class="FIT_WARNING_BADGE_CLASS">
              <TriangleAlertIcon class="size-3" />
              {{ $t(fitWarningKey) }}
            </span>
          </div>
          <p class="text-muted-foreground text-sm">{{ $t(displayInfo.descriptionKey) }}</p>
        </div>

        <span
          v-if="!open && collapsedModelLabel"
          class="text-muted-foreground hidden max-w-60 shrink-0 truncate text-xs @lg/feature-header:inline"
        >
          {{ collapsedModelLabel }}
        </span>
      </CollapsibleTrigger>
      <div class="shrink-0 pr-4 empty:hidden">
        <AiUsageBadge :feature="featureStatus.feature" />
      </div>
    </div>

    <CollapsibleContent>
      <div class="border-t px-4 pt-4 pb-4">
        <div
          v-if="hasNothingToPick"
          class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center"
        >
          <BrainIcon class="text-muted-foreground size-8" />
          <h5 class="font-medium">{{ $t('settings.ai.modelSelector.empty.title') }}</h5>
          <p class="text-muted-foreground max-w-md text-sm">{{ $t('settings.ai.modelSelector.empty.description') }}</p>
          <Button as-child class="mt-2">
            <router-link :to="{ name: ROUTES_NAMES.settingsAiModels }">
              <PlusIcon class="size-4" />
              {{ $t('settings.ai.connections.addButton') }}
            </router-link>
          </Button>
        </div>

        <template v-else>
          <SelectField
            :model-value="selectedOption"
            :values="options"
            :label-key="formatOptionLabel"
            value-key="value"
            :label="$t('settings.ai.modelSelector.modelLabel')"
            :placeholder="$t('settings.ai.modelSelector.placeholder')"
            :disabled="isUpdating"
            @update:model-value="handleSelectChange"
          >
            <template #label-right>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <span v-if="fitWarningKey" :class="FIT_WARNING_BADGE_CLASS">
                  <TriangleAlertIcon class="size-3" />
                  {{ $t(fitWarningKey) }}
                </span>
                <ModelGuidePopover :feature-status="featureStatus" :fit="fit" />
              </div>
            </template>
          </SelectField>

          <Callout
            v-if="!featureStatus.servedBy && featureStatus.connectionId"
            variant="destructive"
            class="mt-3 text-xs"
            icon-size-class="size-3.5"
          >
            <i18n-t keypath="settings.ai.modelSelector.allConnectionsDown" tag="p">
              <template #link>
                <router-link :to="{ name: ROUTES_NAMES.settingsAiModels }" class="text-primary-text hover:underline">
                  {{ $t('settings.ai.modelSelector.allConnectionsDownLink') }}
                </router-link>
              </template>
            </i18n-t>
          </Callout>

          <p
            v-if="formattedPrice && displayInfo.unitLabelKey && featureStatus.servedBy === 'connection'"
            class="text-muted-foreground mt-3 text-xs"
          >
            <span class="font-medium">{{ $t('settings.ai.modelSelector.modelInfo.estimatedCost') }}</span>
            {{ formattedPrice }} {{ $t(displayInfo.unitLabelKey) }}
          </p>
        </template>

        <div v-if="displayInfo.howItWorksKeys.length" class="mt-4 border-t pt-4">
          <h5 class="mb-2 text-sm font-medium">{{ $t('settings.ai.features.howItWorks') }}</h5>
          <ul class="text-muted-foreground list-disc space-y-1.5 pl-5 text-xs leading-relaxed">
            <li v-for="key in displayInfo.howItWorksKeys" :key="key">{{ $t(key) }}</li>
          </ul>
        </div>

        <slot name="extras" />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { getAIFeatureDisplayInfo } from '@/common/const';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import ApiKeySourceBadge from '@/components/common/api-key-source-badge.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useNotificationCenter } from '@/components/notification-center';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiConnectionsList } from '@/composable/data-queries/use-ai-connections';
import { extractApiErrorMessage } from '@/js/errors';
import { ROUTES_NAMES } from '@/routes';
import { AIFeatureStatus, AIModelPricing, getModelNameFromModelId } from '@bt/shared/types';
import { BrainIcon, ChevronRightIcon, PlusIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { type FeatureModelOption, buildFeatureModelOptions, readFeatureSelectValue } from './feature-model-options';
import { type ModelFitWarning, checkModelFit } from './model-fit';
import ModelGuidePopover from './model-guide-popover.vue';

const props = defineProps<{
  featureStatus: AIFeatureStatus;
}>();

const { t } = useI18n();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const { setFeatureConfig, isSettingFeatureConfig, resetFeatureConfig, isResettingFeatureConfig } = useAiSettings();
const { connections } = useAiConnectionsList();
const displayInfo = computed(() => getAIFeatureDisplayInfo({ feature: props.featureStatus.feature }));
const isUpdating = computed(() => isSettingFeatureConfig.value || isResettingFeatureConfig.value);

const hasNothingToPick = computed(
  () => !props.featureStatus.connectionId && props.featureStatus.serverModelName === null,
);

const options = computed(() =>
  buildFeatureModelOptions({ status: props.featureStatus, connections: connections.value }),
);

/**
 * What the select shows. Owned here rather than derived from the props, so a pick the
 * server refuses can be moved back.
 */
const selectValue = ref(readFeatureSelectValue({ status: props.featureStatus }));
const selectedOption = computed(() => options.value.find((option) => option.value === selectValue.value) ?? null);

watch(
  () => props.featureStatus,
  (status) => {
    selectValue.value = readFeatureSelectValue({ status });
  },
);

const fit = computed(() =>
  props.featureStatus.servedBy === 'connection'
    ? checkModelFit({ needs: displayInfo.value.modelGuide.needs, capabilities: props.featureStatus.capabilities })
    : null,
);

const FIT_WARNING_KEYS: Record<ModelFitWarning, string> = {
  readsFiles: 'settings.ai.modelGuide.warning.readsFiles',
  readsText: 'settings.ai.modelGuide.warning.readsText',
  readsImages: 'settings.ai.modelGuide.warning.readsImages',
  readsPdfs: 'settings.ai.modelGuide.warning.readsPdfs',
  longAnswers: 'settings.ai.modelGuide.warning.longAnswers',
  structuredAnswers: 'settings.ai.modelGuide.warning.structuredAnswers',
};

const FIT_WARNING_BADGE_CLASS =
  'bg-warning/12 text-warning-text inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

const fitWarningKey = computed(() => {
  const warning = fit.value?.verdict === 'gaps' ? fit.value.warning : null;
  return warning ? FIT_WARNING_KEYS[warning] : null;
});

const serverLabel = computed(() => t('settings.ai.modelSelector.serverOption'));

const formatOptionLabel = (option: FeatureModelOption) => {
  if (option.kind === 'server') return serverLabel.value;
  if (option.kind === 'connection') {
    const params = { name: option.name, model: option.model };
    return option.needsAttention
      ? t('settings.ai.modelSelector.connectionOptionNeedsAttention', params)
      : t('settings.ai.modelSelector.connectionOption', params);
  }
  if (!option.target) return t('settings.ai.modelSelector.automaticOption');
  return t('settings.ai.modelSelector.automaticOptionWithTarget', {
    target: option.target.kind === 'server' ? serverLabel.value : option.target.name,
  });
};

const collapsedModelLabel = computed(() => {
  const { servedBy, connectionName, modelId } = props.featureStatus;
  if (servedBy === 'server') return serverLabel.value;
  if (servedBy === 'connection' && connectionName) {
    return t('settings.ai.modelSelector.connectionOption', {
      name: connectionName,
      model: getModelNameFromModelId({ modelId }),
    });
  }
  return '';
});

const PRICED_UNITS = 100;

const formatPricePer100 = (pricing: AIModelPricing | null): string | null => {
  const tokens = displayInfo.value.tokensPerUnit;
  if (!pricing || !tokens) return null;

  const inputCost = (tokens.input * PRICED_UNITS * pricing.inputPerMillion) / 1_000_000;
  const outputCost = (tokens.output * PRICED_UNITS * pricing.outputPerMillion) / 1_000_000;
  const totalCost = inputCost + outputCost;

  if (totalCost < 0.001) {
    return '<$0.001';
  }
  if (totalCost < 0.01) {
    return `~$${totalCost.toFixed(4)}`;
  }
  return `~$${totalCost.toFixed(3)}`;
};

const formattedPrice = computed(() => formatPricePer100(props.featureStatus.pricing));

const handleSelectChange = async (option: FeatureModelOption | null) => {
  if (!option || option.value === selectValue.value) return;

  // Moved before the request so the select answers the click; a refusal moves it back.
  selectValue.value = option.value;
  const isReset = option.kind === 'automatic';

  try {
    if (isReset) {
      await resetFeatureConfig({ feature: props.featureStatus.feature });
      addSuccessNotification(t('settings.ai.modelSelector.notifications.resetSuccess'));
    } else {
      await setFeatureConfig({
        feature: props.featureStatus.feature,
        connectionId: option.kind === 'server' ? null : option.value,
      });
      addSuccessNotification(t('settings.ai.modelSelector.notifications.updateSuccess'));
    }
  } catch (error) {
    selectValue.value = readFeatureSelectValue({ status: props.featureStatus });
    const fallbackKey = isReset
      ? 'settings.ai.modelSelector.notifications.resetFailed'
      : 'settings.ai.modelSelector.notifications.updateFailed';
    addErrorNotification(extractApiErrorMessage(error) ?? t(fallbackKey));
  }
};
</script>
