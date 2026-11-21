<template>
  <ResponsiveDialog :open="open" dialog-content-class="sm:max-w-2xl" @update:open="emit('update:open', $event)">
    <template #title>{{ dialogTitle }}</template>

    <PlanRestricted :feature="FEATURES.bank_providers" overlay>
      <!-- Step 1: Select Provider -->
      <template v-if="currentStep === 'select-provider'">
        <p class="text-muted-foreground mt-2 mb-3 text-sm">
          {{ t('pages.integrations.addDialog.selectProviderHint') }}
        </p>

        <div class="mb-4 flex flex-wrap gap-1.5">
          <UiButton
            variant="ghost"
            :class="chipClass(selectedRegionFilter === REGION_FILTER_ALL)"
            @click="selectedRegionFilter = REGION_FILTER_ALL"
          >
            {{ t('pages.integrations.filters.all') }}
          </UiButton>
          <UiButton
            v-for="group in REGION_FILTER_GROUPS"
            :key="group.key"
            variant="ghost"
            :class="chipClass(selectedRegionFilter === group.key)"
            @click="selectedRegionFilter = group.key"
          >
            <img
              :src="`/img/flags/${group.flagCode}.svg`"
              :alt="t(group.labelKey)"
              class="h-3 w-[18px] rounded-[2px] object-cover"
            />
            {{ t(group.labelKey) }}
          </UiButton>
        </div>

        <div class="grid gap-0.5">
          <UiButton
            v-for="row in providerRows"
            :key="row.type"
            variant="ghost"
            :class="cn('h-auto w-full min-w-0 justify-start gap-3 px-3 py-2.5', row.isDimmed && 'disabled:opacity-25')"
            :disabled="row.isDimmed"
            @click="handleSelectProvider(row.type)"
          >
            <BankProviderLogo class="size-9 shrink-0" :provider="row.type" />

            <span class="min-w-0 flex-1 text-left">
              <span class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{{ row.name }}</span>
                <span
                  v-if="row.type === BANK_PROVIDER_TYPE.ENABLE_BANKING"
                  class="bg-warning/20 text-warning-text shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase"
                >
                  {{ t('pages.integrations.addDialog.betaBadge') }}
                </span>
              </span>

              <span class="text-muted-foreground block truncate text-xs font-normal">
                {{ t(row.meta.descriptionKey) }}
              </span>

              <span class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal">
                <span :class="pricingClass(row.meta.pricing)">{{ t(row.meta.pricingLabelKey) }}</span>

                <span class="text-muted-foreground">·</span>

                <ResponsiveTooltip :content="t(row.meta.difficultyTooltipKey)" content-class-name="max-w-xs text-wrap">
                  <span class="text-muted-foreground inline-flex items-center gap-1">
                    <span :class="difficultyDotClass(row.meta.difficulty)" />
                    {{ t(row.meta.difficultyLabelKey) }}
                    <InfoIcon class="size-3" />
                  </span>
                </ResponsiveTooltip>

                <span class="text-muted-foreground">·</span>

                <ResponsiveTooltip :content="row.regionsTooltip" content-class-name="max-w-xs text-wrap">
                  <span class="inline-flex items-center gap-1">
                    <img
                      v-for="region in row.visibleRegions"
                      :key="region.code"
                      :src="`/img/flags/${region.code}.svg`"
                      :alt="t(region.labelKey)"
                      class="h-3 w-[18px] rounded-[2px] object-cover"
                    />
                    <span v-if="row.hiddenRegionsCount" class="text-muted-foreground text-[11px] font-semibold">
                      +{{ row.hiddenRegionsCount }}
                    </span>
                  </span>
                </ResponsiveTooltip>
              </span>
            </span>

            <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
          </UiButton>
        </div>
      </template>

      <!-- Step 2: Provider-specific connection flow -->
      <template v-else-if="currentStep === 'connect-provider' && selectedProviderType">
        <MonobankConnector
          v-if="selectedProviderType === BANK_PROVIDER_TYPE.MONOBANK"
          @connected="handleProviderConnected"
          @cancel="handleCancel"
        />
        <EnableBankingConnector
          v-else-if="selectedProviderType === BANK_PROVIDER_TYPE.ENABLE_BANKING"
          @connected="handleProviderConnected"
          @cancel="handleCancel"
        />
        <LunchFlowConnector
          v-else-if="selectedProviderType === BANK_PROVIDER_TYPE.LUNCHFLOW"
          @connected="handleProviderConnected"
          @cancel="handleCancel"
        />
        <WalutomatConnector
          v-else-if="selectedProviderType === BANK_PROVIDER_TYPE.WALUTOMAT"
          @connected="handleProviderConnected"
          @cancel="handleCancel"
        />
        <SimplefinConnector
          v-else-if="selectedProviderType === BANK_PROVIDER_TYPE.SIMPLEFIN"
          @connected="handleProviderConnected"
          @cancel="handleCancel"
        />
        <AkahuConnector
          v-else-if="selectedProviderType === BANK_PROVIDER_TYPE.AKAHU"
          @connected="handleProviderConnected"
          @cancel="handleCancel"
        />
      </template>
    </PlanRestricted>
  </ResponsiveDialog>
</template>

<script lang="ts" setup>
import type { BankProvider } from '@/api/bank-data-providers';
import {
  type DifficultyType,
  METAINFO_FROM_TYPE,
  type PricingType,
  PROVIDER_DISPLAY_ORDER,
  REGION_FILTER_ALL,
  REGION_FILTER_GROUPS,
  providerMatchesRegionFilter,
} from '@/common/const/bank-providers';
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import BankProviderLogo from '@/components/common/bank-providers/bank-provider-logo.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import { BANK_PROVIDER_TYPE, FEATURES } from '@bt/shared/types';
import { ChevronRightIcon, InfoIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AkahuConnector from './akahu-connector.vue';
import EnableBankingConnector from './enable-banking-connector.vue';
import LunchFlowConnector from './lunchflow-connector.vue';
import MonobankConnector from './monobank-connector.vue';
import SimplefinConnector from './simplefin-connector.vue';
import WalutomatConnector from './walutomat-connector.vue';

const { t } = useI18n();

interface Props {
  open: boolean;
  providers: BankProvider[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'integration-added': [];
}>();

type Step = 'select-provider' | 'connect-provider';

const currentStep = ref<Step>('select-provider');
const selectedProviderType = ref<string | null>(null);
const selectedRegionFilter = ref<string>(REGION_FILTER_ALL);

const dialogTitle = computed(() => {
  if (currentStep.value === 'select-provider') {
    return t('pages.integrations.addDialog.titleSelect');
  }
  const provider = props.providers.find((p) => p.type === selectedProviderType.value);
  return t('pages.integrations.addDialog.titleConnect', { provider: provider?.name || 'Provider' });
});

const sortedProviders = computed(() => {
  const orderIndex = (type: string) => {
    const index = PROVIDER_DISPLAY_ORDER.indexOf(type);
    return index === -1 ? PROVIDER_DISPLAY_ORDER.length : index;
  };
  return [...props.providers].sort((a, b) => orderIndex(a.type) - orderIndex(b.type));
});

const MAX_VISIBLE_FLAGS = 3;

const providerRows = computed(() => {
  const activeGroup = REGION_FILTER_GROUPS.find((group) => group.key === selectedRegionFilter.value);

  return sortedProviders.value.map((provider) => {
    const meta = METAINFO_FROM_TYPE[provider.type]!;
    return {
      type: provider.type,
      name: provider.name,
      meta,
      visibleRegions: meta.regions.slice(0, MAX_VISIBLE_FLAGS),
      hiddenRegionsCount: Math.max(meta.regions.length - MAX_VISIBLE_FLAGS, 0),
      regionsTooltip: meta.regions.map((region) => t(region.labelKey)).join(', '),
      isDimmed: activeGroup ? !providerMatchesRegionFilter({ regions: meta.regions, codes: activeGroup.codes }) : false,
    };
  });
});

const chipClass = (isActive: boolean) =>
  cn(
    'h-auto rounded-full px-3 py-1 text-xs font-semibold',
    isActive ? 'bg-primary/15 border-primary text-primary-text border' : 'bg-muted text-foreground',
  );

const pricingClass = (pricing: PricingType) =>
  pricing === 'free' ? 'text-success-text font-medium' : 'text-warning-text font-medium';

const DIFFICULTY_DOT_COLOR: Record<DifficultyType, string> = {
  easy: 'bg-success-text',
  medium: 'bg-warning-text',
  'very-difficult': 'bg-destructive-text',
};

const difficultyDotClass = (difficulty: DifficultyType) =>
  cn('size-1.5 rounded-full', DIFFICULTY_DOT_COLOR[difficulty]);

const handleSelectProvider = (providerType: string) => {
  selectedProviderType.value = providerType;
  currentStep.value = 'connect-provider';
  trackAnalyticsEvent({
    event: 'bank_connection_opened',
    properties: { provider: providerType },
  });
};

const handleProviderConnected = () => {
  emit('integration-added');
  resetDialog();
};

const handleCancel = () => {
  currentStep.value = 'select-provider';
  selectedProviderType.value = null;
};

const resetDialog = () => {
  currentStep.value = 'select-provider';
  selectedProviderType.value = null;
  selectedRegionFilter.value = REGION_FILTER_ALL;
};

// Reset dialog state when it closes
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      setTimeout(resetDialog, 200); // Small delay to avoid visual glitches
    }
  },
);
</script>
