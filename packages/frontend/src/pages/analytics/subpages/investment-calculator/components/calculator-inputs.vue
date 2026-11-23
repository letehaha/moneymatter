<template>
  <!-- On tablet: 2-col grid across the top. On desktop (lg+): single-col vertical stack in sidebar. -->
  <div class="grid grid-cols-1 gap-5">
    <!-- Initial balance -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <label class="text-sm font-medium">
          {{ $t('analytics.investmentCalculator.initialBalance') }}
        </label>
        <div class="flex items-center gap-1">
          <input
            type="number"
            step="any"
            min="0"
            :value="initialBalance"
            class="text-amount border-input focus:ring-ring bg-input-background h-8 w-28 [appearance:textfield] rounded-md border px-1.5 text-right text-sm transition-colors outline-none focus:ring-1 dark:bg-transparent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            @change="handleExactBalanceInput($event)"
          />
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="ghost" size="icon-sm">
                <SlidersHorizontalIcon class="text-muted-foreground size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-44 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <label class="text-muted-foreground text-xs font-medium">{{
                  $t('analytics.investmentCalculator.rangeMin')
                }}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  :value="balanceRange.min"
                  :class="compactInputClass"
                  @change="updateBalanceMin({ value: parseInputEvent($event) })"
                />
              </div>
              <div class="flex items-center justify-between gap-2">
                <label class="text-muted-foreground text-xs font-medium">{{
                  $t('analytics.investmentCalculator.rangeMax')
                }}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  :value="balanceRange.max"
                  :class="compactInputClass"
                  @change="updateBalanceMax({ value: parseInputEvent($event) })"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Slider
        :model-value="initialBalance"
        :min="balanceRange.min"
        :max="effectiveBalanceMax"
        :step="BALANCE_STEP"
        @update:model-value="$emit('update:initialBalance', $event)"
      />
      <div class="text-muted-foreground flex justify-between text-xs">
        <span>{{ formatCompact({ value: balanceRange.min }) }}</span>
        <span>{{ formatCompact({ value: effectiveBalanceMax }) }}</span>
      </div>
      <Button
        variant="link"
        class="text-muted-foreground h-auto p-0 text-xs underline underline-offset-2 hover:no-underline"
        @click="$emit('useCurrentBalance')"
      >
        {{ $t('analytics.investmentCalculator.useCurrentBalance') }}
      </Button>
    </div>

    <!-- Monthly contribution -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <label class="text-sm font-medium">
          {{ $t('analytics.investmentCalculator.monthlyContribution') }}
        </label>
        <div class="flex items-center gap-1">
          <span class="text-muted-foreground text-amount text-sm">
            {{ formatBaseCurrency(monthlyContribution, { revealed: true }) }}
          </span>
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="ghost" size="icon-sm">
                <SlidersHorizontalIcon class="text-muted-foreground size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-44 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <label class="text-muted-foreground text-xs font-medium">{{
                  $t('analytics.investmentCalculator.rangeMin')
                }}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  :value="contributionRange.min"
                  :class="compactInputClass"
                  @change="updateContributionMin({ value: parseInputEvent($event) })"
                />
              </div>
              <div class="flex items-center justify-between gap-2">
                <label class="text-muted-foreground text-xs font-medium">{{
                  $t('analytics.investmentCalculator.rangeMax')
                }}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  :value="contributionRange.max"
                  :class="compactInputClass"
                  @change="updateContributionMax({ value: parseInputEvent($event) })"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Slider
        :model-value="monthlyContribution"
        :min="contributionRange.min"
        :max="effectiveContributionMax"
        :step="CONTRIBUTION_STEP"
        @update:model-value="$emit('update:monthlyContribution', $event)"
      />
      <div class="text-muted-foreground flex justify-between text-xs">
        <span>{{ formatCompact({ value: contributionRange.min }) }}</span>
        <span>{{ formatCompact({ value: effectiveContributionMax }) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <ResponsiveTooltip
          :content="$t('analytics.investmentCalculator.useAvgNetIncomeTooltip')"
          content-class-name="max-w-56"
        >
          <span class="text-muted-foreground cursor-help text-xs underline decoration-dashed underline-offset-2">
            {{ $t('analytics.investmentCalculator.useAvgNetIncome') }}
          </span>
        </ResponsiveTooltip>
        <PillTabs
          :items="netIncomePeriods"
          :model-value="selectedPeriod ?? ''"
          size="sm"
          @update:model-value="$emit('update:selectedPeriod', $event as NetIncomePeriod)"
        />
      </div>
    </div>

    <!-- Time horizon -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <label class="text-sm font-medium">
          {{ $t('analytics.investmentCalculator.timeHorizon') }}
        </label>
        <div class="flex items-center gap-1">
          <span data-testid="horizon-value" class="text-muted-foreground text-amount text-sm"
            >{{ timeHorizonYears }}yr</span
          >
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="ghost" size="icon-sm">
                <SlidersHorizontalIcon class="text-muted-foreground size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-44 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <label class="text-muted-foreground text-xs font-medium">{{
                  $t('analytics.investmentCalculator.rangeMin')
                }}</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  :value="horizonRange.min"
                  :class="compactInputClass"
                  @change="updateHorizonMin({ value: parseInputEvent($event) })"
                />
              </div>
              <div class="flex items-center justify-between gap-2">
                <label class="text-muted-foreground text-xs font-medium">{{
                  $t('analytics.investmentCalculator.rangeMax')
                }}</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  :value="horizonRange.max"
                  :class="compactInputClass"
                  @change="updateHorizonMax({ value: parseInputEvent($event) })"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Slider
        :model-value="timeHorizonYears"
        :min="horizonRange.min"
        :max="effectiveHorizonMax"
        :step="HORIZON_STEP"
        @update:model-value="$emit('update:timeHorizonYears', $event)"
      />
      <div class="text-muted-foreground flex justify-between text-xs">
        <span>{{ horizonRange.min }}yr</span>
        <span>{{ effectiveHorizonMax }}yr</span>
      </div>
    </div>

    <!-- Market indicator selector -->
    <div>
      <SelectField
        :model-value="selectedIndicatorOption"
        :values="indicatorOptions"
        :option-disabled="isOptionDisabled"
        :label="$t('analytics.investmentCalculator.annualReturn')"
        label-key="label"
        value-key="id"
        @update:model-value="handleIndicatorChange($event)"
      />

      <!-- Custom return rate input (shown when Custom is selected) -->
      <div v-if="selectedIndicatorId === CUSTOM_INDICATOR_ID" class="mt-2">
        <InputField
          :model-value="annualReturnRate"
          type="number"
          :placeholder="$t('analytics.investmentCalculator.customReturnRate')"
          @update:model-value="$emit('update:annualReturnRate', toNumber($event))"
        >
          <template #iconTrailing>
            <PercentIcon class="text-muted-foreground size-4" />
          </template>
        </InputField>
      </div>
    </div>

    <!-- Annual inflation (slider) -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <ResponsiveTooltip
          :content="$t('analytics.investmentCalculator.inflationTooltip')"
          content-class-name="max-w-64 whitespace-pre-line"
        >
          <label class="cursor-help text-sm font-medium underline decoration-dashed underline-offset-2">
            {{ $t('analytics.investmentCalculator.annualInflation') }}
          </label>
        </ResponsiveTooltip>
        <span class="text-muted-foreground text-amount text-sm">{{ annualInflationRate }}%</span>
      </div>
      <Slider
        :model-value="annualInflationRate"
        :min="0"
        :max="MAX_INFLATION"
        :step="INFLATION_STEP"
        @update:model-value="$emit('update:annualInflationRate', $event)"
      />
      <div class="text-muted-foreground flex justify-between text-xs">
        <span>0%</span>
        <span>{{ MAX_INFLATION }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Slider } from '@/components/lib/ui/slider';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { useFormatCurrency } from '@/composable';
import { PercentIcon, SlidersHorizontalIcon } from '@lucide/vue';
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  buildReturnOptions,
  CUSTOM_INDICATOR_ID,
  MARKET_INDICATORS,
  type ReturnOption,
} from '@/pages/analytics/utils/market-indicators';
import { getPortfolioIdFromIndicatorId, isPortfolioIndicatorId } from '@bt/shared/types';
import type { NetIncomePeriod } from '../composables/use-seed-data';
import type { PortfolioAnnualizedReturnModel } from '@bt/shared/types/investments/portfolio-annualized-return.model';

const { t } = useI18n();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const BALANCE_STEP = 10_000;
const CONTRIBUTION_STEP = 100;
const HORIZON_STEP = 1;
const INFLATION_STEP = 0.5;
const MAX_INFLATION = 15;

const DEFAULT_BALANCE_MAX = 100_000;
const DEFAULT_CONTRIBUTION_MAX = 10_000;
const DEFAULT_HORIZON_MAX = 20;

const props = defineProps<{
  initialBalance: number;
  monthlyContribution: number;
  timeHorizonYears: number;
  annualReturnRate: number;
  annualInflationRate: number;
  selectedPeriod: NetIncomePeriod | null;
  selectedIndicatorId: string;
  currentTotalBalance: number;
  portfolioReturns: PortfolioAnnualizedReturnModel[];
}>();

const emit = defineEmits<{
  'update:initialBalance': [value: number];
  'update:monthlyContribution': [value: number];
  'update:timeHorizonYears': [value: number];
  'update:annualReturnRate': [value: number];
  'update:annualInflationRate': [value: number];
  'update:selectedPeriod': [value: NetIncomePeriod];
  'update:selectedIndicatorId': [value: string];
  useCurrentBalance: [];
}>();

const toNumber = (value: string | number | null): number => {
  if (value === null || value === '') return 0;
  return Number(value) || 0;
};

const compactInputClass =
  'h-8 w-24 rounded-md border border-input bg-input-background dark:bg-transparent px-1.5 text-right text-sm outline-none transition-colors focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const parseInputEvent = (event: Event): number => {
  const raw = parseFloat((event.target as HTMLInputElement).value);
  return isNaN(raw) ? 0 : Math.max(0, raw);
};

const handleExactBalanceInput = (event: Event) => {
  const value = parseInputEvent(event);
  emit('update:initialBalance', value);
};

const roundUpToStep = ({ value, step }: { value: number; step: number }): number => Math.ceil(value / step) * step;

const formatCompact = ({ value }: { value: number }): string => {
  const symbol = getCurrencySymbol();
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${Math.round(value / 1_000)}K`;
  return `${symbol}${Math.round(value)}`;
};

const balanceRange = reactive({ min: 0, max: DEFAULT_BALANCE_MAX, hasCustomMax: false });
const contributionRange = reactive({ min: 0, max: DEFAULT_CONTRIBUTION_MAX, hasCustomMax: false });
const horizonRange = reactive({ min: 0, max: DEFAULT_HORIZON_MAX, hasCustomMax: false });

watch(
  () => props.currentTotalBalance,
  (val) => {
    if (!balanceRange.hasCustomMax && val > 0) {
      balanceRange.max = roundUpToStep({ value: val * 5, step: BALANCE_STEP });
    }
  },
  { immediate: true },
);

const effectiveBalanceMax = computed(() => Math.max(balanceRange.max, props.initialBalance));
const effectiveContributionMax = computed(() => Math.max(contributionRange.max, props.monthlyContribution));
const effectiveHorizonMax = computed(() => Math.max(horizonRange.max, props.timeHorizonYears));

const updateBalanceMin = ({ value }: { value: number }) => {
  balanceRange.min = value;
  if (balanceRange.max < value) balanceRange.max = value;
  if (props.initialBalance < value) emit('update:initialBalance', value);
};

const updateBalanceMax = ({ value }: { value: number }) => {
  balanceRange.max = value;
  balanceRange.hasCustomMax = true;
  if (balanceRange.min > value) balanceRange.min = value;
  if (props.initialBalance > value) emit('update:initialBalance', value);
};

const updateContributionMin = ({ value }: { value: number }) => {
  contributionRange.min = value;
  if (contributionRange.max < value) contributionRange.max = value;
  if (props.monthlyContribution < value) emit('update:monthlyContribution', value);
};

const updateContributionMax = ({ value }: { value: number }) => {
  contributionRange.max = value;
  contributionRange.hasCustomMax = true;
  if (contributionRange.min > value) contributionRange.min = value;
  if (props.monthlyContribution > value) emit('update:monthlyContribution', value);
};

const updateHorizonMin = ({ value }: { value: number }) => {
  horizonRange.min = value;
  if (horizonRange.max < value) horizonRange.max = value;
  if (props.timeHorizonYears < value) emit('update:timeHorizonYears', value);
};

const updateHorizonMax = ({ value }: { value: number }) => {
  const clamped = Math.max(value, 1);
  horizonRange.max = clamped;
  horizonRange.hasCustomMax = true;
  if (horizonRange.min > clamped) horizonRange.min = clamped;
  if (props.timeHorizonYears > clamped) emit('update:timeHorizonYears', clamped);
};

const netIncomePeriods: { value: NetIncomePeriod; label: string }[] = [
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: '12mo', label: '12M' },
  { value: 'all', label: 'All' },
];

const indicatorOptions = computed(() => buildReturnOptions({ portfolioReturns: props.portfolioReturns, t }));

const selectedIndicatorOption = computed(
  () => indicatorOptions.value.find((o) => o.id === props.selectedIndicatorId) ?? null,
);

const isOptionDisabled = (option: ReturnOption): boolean => option.disabled === true;

const handleIndicatorChange = (option: ReturnOption | null) => {
  if (!option || isOptionDisabled(option)) return;
  emit('update:selectedIndicatorId', option.id);

  if (isPortfolioIndicatorId({ id: option.id })) {
    const portfolioId = getPortfolioIdFromIndicatorId({ id: option.id });
    const portfolio = props.portfolioReturns.find((p) => p.portfolioId === portfolioId);
    if (portfolio && portfolio.annualizedReturn !== null) {
      emit('update:annualReturnRate', portfolio.annualizedReturn);
    }
    return;
  }

  const indicator = MARKET_INDICATORS.find((i) => i.id === option.id);
  if (indicator) {
    emit('update:annualReturnRate', indicator.avgAnnualReturn);
  }
};
</script>
