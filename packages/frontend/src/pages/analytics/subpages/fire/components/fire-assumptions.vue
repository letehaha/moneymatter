<template>
  <div ref="panel" class="flex flex-col gap-4">
    <h2 class="text-sm font-semibold">{{ $t('analytics.fire.assumptions.title') }}</h2>

    <SidePanelSections>
      <SidePanelSection v-model:open="openSections.spending">
        <SidePanelSectionTrigger :icon="WalletIcon">
          {{ $t('analytics.fire.assumptions.spendingLabel') }}
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <div ref="spending" class="flex flex-col gap-2">
            <InputField
              :model-value="displayValue({ key: 'annualSpendingOverride' })"
              type="number"
              only-positive
              non-label-wrapper
              min="0"
              :class="cn(spendingBadge && BADGE_INPUT_CLASS)"
              trailing-icon-css-class="px-2"
              :aria-label="$t('analytics.fire.assumptions.spendingLabel')"
              :placeholder="$t('analytics.fire.assumptions.spendingPlaceholder')"
              @update:model-value="onNumberInput({ key: 'annualSpendingOverride', value: $event })"
              @blur="onNumberBlur({ key: 'annualSpendingOverride' })"
            >
              <template #iconLeading>
                <span class="text-muted-foreground text-sm">{{ currencySymbol }}</span>
              </template>
              <template v-if="spendingBadge" #iconTrailing>
                <ResponsiveTooltip
                  v-if="spendingBadge === 'auto'"
                  :content="
                    $t('analytics.fire.assumptions.autoSpendingHint', {
                      n: seed.monthsUsed,
                      typical: formatBaseCurrency(seed.typicalMonth ?? 0),
                    })
                  "
                >
                  <span :class="cn(BADGE_CLASS, 'text-success-text cursor-help')">{{ $t('analytics.fire.auto') }}</span>
                </ResponsiveTooltip>
                <span v-else :class="cn(BADGE_CLASS, 'text-warning-text')">
                  {{ $t('analytics.fire.assumptions.requiredBadge') }}
                </span>
              </template>
            </InputField>

            <Button
              v-if="!plan.inputs.spendingIsAuto && seed.spending !== null"
              variant="link"
              size="sm"
              class="h-auto self-start p-0 text-xs"
              @click="update({ patch: { annualSpendingOverride: null } })"
            >
              {{ $t('analytics.fire.assumptions.backToAuto', { amount: formatBaseCurrency(seed.spending) }) }}
            </Button>

            <CategoryMultiSelectField
              :model-value="settings.spendingExcludedCategoryIds"
              :label="$t('analytics.fire.assumptions.excludedLabel')"
              :placeholder="$t('analytics.fire.assumptions.excludedPlaceholder')"
              @update:model-value="onExcludedChange({ ids: $event })"
            />

            <i18n-t keypath="analytics.fire.assumptions.savingsNote" tag="p" class="text-muted-foreground text-xs">
              <template #link>
                <RouterLink :to="{ name: ROUTES_NAMES.settingsGeneral }" class="text-primary-text hover:underline">
                  {{ $t('analytics.fire.assumptions.savingsNoteLink') }}
                </RouterLink>
              </template>
            </i18n-t>
          </div>
        </SidePanelSectionContent>
      </SidePanelSection>

      <SidePanelSection v-model:open="openSections.contribution">
        <SidePanelSectionTrigger :icon="PiggyBankIcon">
          {{ $t('analytics.fire.assumptions.contributionLabel') }}
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <div ref="contribution" class="flex flex-col gap-2">
            <InputField
              :model-value="displayValue({ key: 'monthlyContributionOverride' })"
              type="number"
              non-label-wrapper
              :class="cn(plan.inputs.contributionIsAuto && BADGE_INPUT_CLASS)"
              trailing-icon-css-class="px-2"
              :aria-label="$t('analytics.fire.assumptions.contributionLabel')"
              :placeholder="$t('analytics.fire.assumptions.contributionPlaceholder')"
              @update:model-value="onNumberInput({ key: 'monthlyContributionOverride', value: $event })"
              @blur="onNumberBlur({ key: 'monthlyContributionOverride' })"
            >
              <template #iconLeading>
                <span class="text-muted-foreground text-sm">{{ currencySymbol }}</span>
              </template>
              <template v-if="plan.inputs.contributionIsAuto" #iconTrailing>
                <ResponsiveTooltip
                  :content="$t('analytics.fire.assumptions.autoContributionHint', { n: seed.monthsUsed })"
                >
                  <span :class="cn(BADGE_CLASS, 'text-success-text cursor-help')">{{ $t('analytics.fire.auto') }}</span>
                </ResponsiveTooltip>
              </template>
            </InputField>

            <Button
              v-if="!plan.inputs.contributionIsAuto && hasSeedHistory"
              variant="link"
              size="sm"
              class="h-auto self-start p-0 text-xs"
              @click="update({ patch: { monthlyContributionOverride: null } })"
            >
              {{ $t('analytics.fire.assumptions.backToAuto', { amount: formatBaseCurrency(seed.contribution) }) }}
            </Button>

            <p v-if="seed.savingsRate !== null" class="text-muted-foreground text-xs">
              {{ $t('analytics.fire.assumptions.savingsRate', { pct: formatPct({ value: seed.savingsRate }) }) }}
            </p>
          </div>
        </SidePanelSectionContent>
      </SidePanelSection>

      <SidePanelSection v-model:open="openSections.counts">
        <SidePanelSectionTrigger :icon="LayersIcon">
          {{ $t('analytics.fire.assumptions.countsTitle') }}
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <div ref="counts" class="flex flex-col gap-2">
            <div v-for="row in countRows" :key="row.key" class="flex items-center justify-between gap-3 text-sm">
              <label class="flex items-center gap-2">
                <Switch
                  :model-value="row.setting === null || settings[row.setting]"
                  :disabled="row.setting === null"
                  @update:model-value="onCountToggle({ setting: row.setting, value: $event })"
                />
                {{ row.label }}
              </label>
              <span class="text-muted-foreground tabular-nums">{{ formatBaseCurrency(row.amount) }}</span>
            </div>
            <p class="text-muted-foreground text-xs">{{ $t('analytics.fire.assumptions.countsHint') }}</p>
            <i18n-t
              v-if="archivedHeld.count > 0"
              keypath="analytics.fire.assumptions.archivedNote"
              :plural="archivedHeld.count"
              tag="p"
              class="text-muted-foreground text-xs"
            >
              <template #count>{{ archivedHeld.count }}</template>
              <template #amount>{{ formatBaseCurrency(archivedHeld.amount) }}</template>
              <template #link>
                <RouterLink :to="{ name: ROUTES_NAMES.accounts }" class="text-primary-text hover:underline">
                  {{ $t('analytics.fire.assumptions.archivedNoteLink') }}
                </RouterLink>
              </template>
            </i18n-t>
          </div>
        </SidePanelSectionContent>
      </SidePanelSection>

      <SidePanelSection v-model:open="openSections.return">
        <SidePanelSectionTrigger :icon="TrendingUpIcon">
          {{ $t('analytics.investmentCalculator.annualReturn') }}
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <div ref="return" class="flex flex-col gap-3">
            <AnnualReturnField
              hide-label
              :indicator-id="settings.returnIndicatorId"
              :rate="settings.customReturnPct"
              :format-preset-label="formatPresetLabel"
              @update:indicator-id="onIndicatorChange({ id: $event })"
              @update:rate="onCustomRateChange({ value: $event })"
            />

            <div v-if="isPresetReturn" class="flex items-center justify-between gap-2 text-sm">
              <span class="font-medium">{{ $t('analytics.fire.assumptions.inflationLabel') }}</span>
              <span class="text-muted-foreground flex items-center gap-1.5">
                {{ $t('analytics.fire.assumptions.inflationBuiltIn', { pct: PRESET_INFLATION_PCT }) }}
                <HintIcon :content="$t('analytics.fire.assumptions.inflationBuiltInHint')" />
              </span>
            </div>
            <div v-else class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="font-medium">{{ $t('analytics.fire.assumptions.inflationLabel') }}</span>
                <span class="text-muted-foreground tabular-nums">{{ settings.inflationPct }}%</span>
              </div>
              <Slider
                :model-value="settings.inflationPct"
                :min="INFLATION_SLIDER.min"
                :max="INFLATION_SLIDER.max"
                :step="INFLATION_SLIDER.step"
                :aria-label="$t('analytics.fire.assumptions.inflationLabel')"
                @update:model-value="update({ patch: { inflationPct: $event } })"
              />
            </div>
          </div>
        </SidePanelSectionContent>
      </SidePanelSection>

      <SidePanelSection v-model:open="openSections.withdrawal">
        <SidePanelSectionTrigger :icon="PercentIcon">
          {{ $t('analytics.fire.assumptions.withdrawalLabel') }}
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <div class="flex flex-col gap-2">
            <PillTabs
              :items="withdrawalItems"
              :model-value="withdrawalMode"
              size="sm"
              full-width
              class="[&>button]:px-1"
              @update:model-value="onWithdrawalModeChange({ value: $event })"
            />
            <InputField
              v-if="withdrawalMode === CUSTOM_WITHDRAWAL"
              :model-value="displayValue({ key: 'withdrawalRatePct' })"
              type="number"
              only-positive
              step="0.1"
              :aria-label="$t('analytics.fire.assumptions.withdrawalLabel')"
              :placeholder="$t('analytics.fire.assumptions.withdrawalPlaceholder')"
              @update:model-value="onNumberInput({ key: 'withdrawalRatePct', value: $event })"
              @blur="onNumberBlur({ key: 'withdrawalRatePct' })"
            >
              <template #iconTrailing>
                <PercentIcon class="text-muted-foreground size-4" />
              </template>
            </InputField>
            <p class="text-muted-foreground text-xs">{{ $t('analytics.fire.assumptions.withdrawalHint') }}</p>
          </div>
        </SidePanelSectionContent>
      </SidePanelSection>

      <SidePanelSection v-model:open="openSections.more">
        <SidePanelSectionTrigger :icon="SlidersHorizontalIcon">
          {{ $t('analytics.fire.assumptions.more') }}
          <template #summary>{{ moreSummary }}</template>
        </SidePanelSectionTrigger>
        <SidePanelSectionContent>
          <div class="flex flex-col gap-4">
            <InputField
              v-for="field in moreFields"
              :key="field.key"
              :ref="(el) => setMoreFieldRef({ key: field.key, el })"
              :model-value="displayValue({ key: field.key })"
              type="number"
              only-positive
              :step="field.step"
              :label="field.label"
              :placeholder="field.placeholder"
              @update:model-value="onNumberInput({ key: field.key, value: $event })"
              @blur="onNumberBlur({ key: field.key })"
            >
              <template v-if="field.key === 'baristaMonthlyIncome'" #iconLeading>
                <span class="text-muted-foreground text-sm">{{ currencySymbol }}</span>
              </template>
            </InputField>
          </div>
        </SidePanelSectionContent>
      </SidePanelSection>
    </SidePanelSections>
  </div>
</template>

<script setup lang="ts">
import { flattenCategories } from '@/components/common/combobox-categories.helpers';
import HintIcon from '@/components/common/hint-icon.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import {
  SidePanelSection,
  SidePanelSectionContent,
  SidePanelSectionTrigger,
  SidePanelSections,
} from '@/components/lib/ui/side-panel';
import { Slider } from '@/components/lib/ui/slider';
import { Switch } from '@/components/lib/ui/switch';
import { useFormatCurrency } from '@/composable';
import type { FirePlan } from '@/composable/fire/build-fire-plan';
import { FIRE_SEED_MIN_MONTHS } from '@/composable/fire/derive-fire-seed';
import { toRealAnnual } from '@/composable/fire/fire-math';
import { PRESET_INFLATION_PCT, type ResolvedFireSettings } from '@/composable/fire/resolve-fire-settings';
import { waitForAnimationEnd } from '@/composable/wait-for-animation-end';
import { cn } from '@/lib/utils';
import AnnualReturnField from '@/pages/analytics/components/annual-return-field.vue';
import { CUSTOM_INDICATOR_ID, getIndicatorById } from '@/pages/analytics/utils/market-indicators';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useCategoriesStore } from '@/stores';
import {
  ACCOUNT_STATUSES,
  FIRE_DEFAULTS,
  FIRE_LIMITS,
  FIRE_MAX_EXCLUDED_CATEGORIES,
  type FireSettings,
  isPortfolioIndicatorId,
} from '@bt/shared/types';
import { LayersIcon, PercentIcon, PiggyBankIcon, SlidersHorizontalIcon, TrendingUpIcon, WalletIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { type ComponentPublicInstance, computed, reactive, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { type AssumptionSection, useAssumptionSections } from '../composables/use-assumption-sections';

export type FireFocusField = 'spending' | 'contribution' | 'counts' | 'return' | 'barista' | 'birthYear' | 'coastAge';
export type FireToggleSource = 'includeVentures' | 'includeVehicles' | 'includeLoans';

type NumberKey =
  | 'annualSpendingOverride'
  | 'monthlyContributionOverride'
  | 'baristaMonthlyIncome'
  | 'withdrawalRatePct'
  | 'leanMultiplier'
  | 'fatMultiplier'
  | 'birthYear'
  | 'coastTargetAge';
type LimitedKey = Extract<NumberKey, keyof typeof FIRE_LIMITS>;

const WITHDRAWAL_PRESETS = [3, 3.5, 4, 4.5];
const CUSTOM_WITHDRAWAL = 'custom';
const INFLATION_SLIDER = { min: 0, max: 10, step: 0.5 };
const INTEGER_KEYS: NumberKey[] = ['birthYear', 'coastTargetAge'];
const BADGE_CLASS = 'border-border inline-flex h-6 items-center rounded-full border px-2 text-xs whitespace-nowrap';
// Keeps typed digits clear of the badge, with room for longer translations of it.
const BADGE_INPUT_CLASS = '[&_input]:pr-24';
const MORE_FIELD_BY_FOCUS: Partial<Record<FireFocusField, NumberKey>> = {
  barista: 'baristaMonthlyIncome',
  birthYear: 'birthYear',
  coastAge: 'coastTargetAge',
};

const props = defineProps<{
  modelValue: FireSettings;
  plan: FirePlan;
  settings: ResolvedFireSettings;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: FireSettings] }>();

const { t } = useI18n();
const { openSections } = useAssumptionSections();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();
const { accounts } = storeToRefs(useAccountsStore());
const { formattedCategories } = storeToRefs(useCategoriesStore());

const currencySymbol = computed(() => getCurrencySymbol());
const seed = computed(() => props.plan.inputs.seed);
const hasSeedHistory = computed(() => seed.value.monthsUsed >= FIRE_SEED_MIN_MONTHS);

const spendingBadge = computed<'auto' | 'required' | null>(() => {
  if (!props.plan.inputs.spendingIsAuto) return null;
  return seed.value.spending === null ? 'required' : 'auto';
});

// Children can emit twice in one tick (indicator, then rate); props lag until the parent re-renders.
let latest = props.modelValue;
watch(
  () => props.modelValue,
  (value) => {
    latest = value;
  },
);
const update = ({ patch }: { patch: Partial<FireSettings> }) => {
  latest = { ...latest, ...patch };
  emit('update:modelValue', latest);
};

const formatPct = ({ value }: { value: number }) => `${Number(value.toFixed(1))}%`;

const isLimitedKey = (key: NumberKey): key is LimitedKey => key in FIRE_LIMITS;

const pending = reactive<Partial<Record<NumberKey, number | null>>>({});

const fallbackValue = ({ key }: { key: NumberKey }): number | null => {
  if (key === 'annualSpendingOverride') return seed.value.spending === null ? null : Math.round(seed.value.spending);
  if (key === 'monthlyContributionOverride') return Math.round(seed.value.contribution);
  return props.settings[key];
};

const displayValue = ({ key }: { key: NumberKey }) =>
  key in pending ? (pending[key] ?? null) : (props.modelValue[key] ?? fallbackValue({ key }));

const isValid = ({ key, value }: { key: NumberKey; value: number }) => {
  if (INTEGER_KEYS.includes(key) && !Number.isInteger(value)) return false;
  if (isLimitedKey(key)) return value >= FIRE_LIMITS[key].min && value <= FIRE_LIMITS[key].max;
  return key === 'monthlyContributionOverride' || value >= 0;
};

const emptyValue = ({ key }: { key: NumberKey }): number | null =>
  key === 'withdrawalRatePct' || key === 'leanMultiplier' || key === 'fatMultiplier' || key === 'coastTargetAge'
    ? FIRE_DEFAULTS[key]
    : null;

const clampToLimit = ({ key, value }: { key: keyof typeof FIRE_LIMITS; value: number }) =>
  Math.min(FIRE_LIMITS[key].max, Math.max(FIRE_LIMITS[key].min, value));

const clampValue = ({ key, value }: { key: NumberKey; value: number }) => {
  const rounded = INTEGER_KEYS.includes(key) ? Math.round(value) : value;
  if (isLimitedKey(key)) return clampToLimit({ key, value: rounded });
  return key === 'monthlyContributionOverride' ? rounded : Math.max(0, rounded);
};

// Out-of-range values stay local until blur: the backend rejects them, and the draft autosaves mid-typing.
const onNumberInput = ({ key, value }: { key: NumberKey; value: string | number | null }) => {
  const numeric = value === null || value === '' ? null : Number(value);
  if (numeric !== null && !Number.isNaN(numeric) && isValid({ key, value: numeric })) {
    delete pending[key];
    update({ patch: { [key]: numeric } });
  } else {
    pending[key] = numeric;
  }
};

const onNumberBlur = ({ key }: { key: NumberKey }) => {
  if (!(key in pending)) return;
  const value = pending[key] ?? null;
  delete pending[key];
  update({
    patch: {
      [key]: value === null || Number.isNaN(value) ? emptyValue({ key }) : clampValue({ key, value }),
    },
  });
};

// The server expands a saved parent over its whole subtree, so unticking a subcategory also drops its ancestors.
const onExcludedChange = ({ ids }: { ids: string[] }) => {
  const kept = new Set(ids.slice(0, FIRE_MAX_EXCLUDED_CATEGORIES));
  const removed = new Set(props.settings.spendingExcludedCategoryIds.filter((id) => !kept.has(id)));
  const partialParentIds = new Set<string>(
    flattenCategories({ categories: formattedCategories.value })
      .filter((category) => category.descendantIds.some((id) => removed.has(id)))
      .map((category) => category.id),
  );
  update({
    patch: {
      spendingExcludedCategoryIds: [...kept].filter((id) => !partialParentIds.has(id)),
    },
  });
};

const countRows = computed<{ key: string; label: string; amount: number; setting: FireToggleSource | null }[]>(() => {
  const { buckets } = props.plan.inputs;
  return [
    { key: 'accounts', label: t('analytics.fire.assumptions.countsCash'), amount: buckets.accounts, setting: null },
    {
      key: 'portfolios',
      label: t('analytics.fire.assumptions.countsPortfolios'),
      amount: buckets.portfolios,
      setting: null,
    },
    {
      key: 'ventures',
      label: t('analytics.fire.assumptions.countsVentures'),
      amount: buckets.ventures,
      setting: 'includeVentures',
    },
    {
      key: 'vehicles',
      label: t('analytics.fire.assumptions.countsVehicles'),
      amount: buckets.vehicles,
      setting: 'includeVehicles',
    },
    {
      key: 'loans',
      label: t('analytics.fire.assumptions.countsLoans'),
      amount: buckets.loans,
      setting: 'includeLoans',
    },
  ];
});

const archivedHeld = computed(() => {
  const held = (accounts.value ?? []).filter(
    (account) =>
      account.status === ACCOUNT_STATUSES.archived && account.excludeFromStats && account.refCurrentBalance > 0,
  );
  return { count: held.length, amount: held.reduce((total, account) => total + account.refCurrentBalance, 0) };
});

const onCountToggle = ({ setting, value }: { setting: FireToggleSource | null; value: boolean }) => {
  if (setting !== null) update({ patch: { [setting]: value } });
};

const isPresetReturn = computed(
  () =>
    props.settings.returnFallback !== null ||
    (!isPortfolioIndicatorId({ id: props.settings.returnIndicatorId }) &&
      props.settings.returnIndicatorId !== CUSTOM_INDICATOR_ID),
);

const formatPresetLabel = ({ label, nominalPct }: { label: string; nominalPct: number }) =>
  t('analytics.fire.assumptions.presetLabel', {
    label,
    real: formatPct({ value: toRealAnnual({ nominalPct, inflationPct: PRESET_INFLATION_PCT }) * 100 }),
    nominal: formatPct({ value: nominalPct }),
    inflation: formatPct({ value: PRESET_INFLATION_PCT }),
  });

const onIndicatorChange = ({ id }: { id: string }) => {
  const seedCustom =
    id === CUSTOM_INDICATOR_ID && props.settings.customReturnPct === null
      ? {
          customReturnPct: clampToLimit({
            key: 'customReturnPct',
            value: (
              getIndicatorById({ id: props.settings.returnIndicatorId }) ??
              getIndicatorById({ id: FIRE_DEFAULTS.returnIndicatorId })!
            ).avgAnnualReturn,
          }),
        }
      : {};
  update({ patch: { returnIndicatorId: id, ...seedCustom } });
};

const onCustomRateChange = ({ value }: { value: number }) => {
  if ((latest.returnIndicatorId ?? FIRE_DEFAULTS.returnIndicatorId) !== CUSTOM_INDICATOR_ID) return;
  update({ patch: { customReturnPct: clampToLimit({ key: 'customReturnPct', value }) } });
};

const isCustomWithdrawalPicked = ref(false);
const withdrawalMode = computed(() =>
  isCustomWithdrawalPicked.value || !WITHDRAWAL_PRESETS.includes(props.settings.withdrawalRatePct)
    ? CUSTOM_WITHDRAWAL
    : String(props.settings.withdrawalRatePct),
);
const withdrawalItems = computed(() => [
  ...WITHDRAWAL_PRESETS.map((value) => ({ value: String(value), label: `${value.toFixed(1)}%` })),
  { value: CUSTOM_WITHDRAWAL, label: t('analytics.fire.assumptions.withdrawalCustom') },
]);

const onWithdrawalModeChange = ({ value }: { value: string }) => {
  isCustomWithdrawalPicked.value = value === CUSTOM_WITHDRAWAL;
  if (value !== CUSTOM_WITHDRAWAL) update({ patch: { withdrawalRatePct: Number(value) } });
};

const moreSummary = computed(() =>
  t('analytics.fire.assumptions.moreSummary', {
    lean: props.settings.leanMultiplier,
    fat: props.settings.fatMultiplier,
    age: props.settings.coastTargetAge,
  }),
);
const moreFields = computed<{ key: NumberKey; label: string; placeholder: string; step: string }[]>(() => [
  {
    key: 'leanMultiplier',
    label: t('analytics.fire.assumptions.leanLabel'),
    placeholder: t('analytics.fire.assumptions.leanPlaceholder'),
    step: '0.05',
  },
  {
    key: 'fatMultiplier',
    label: t('analytics.fire.assumptions.fatLabel'),
    placeholder: t('analytics.fire.assumptions.fatPlaceholder'),
    step: '0.1',
  },
  {
    key: 'baristaMonthlyIncome',
    label: t('analytics.fire.assumptions.baristaLabel'),
    placeholder: t('analytics.fire.assumptions.baristaPlaceholder'),
    step: '1',
  },
  {
    key: 'birthYear',
    label: t('analytics.fire.assumptions.birthYearLabel'),
    placeholder: t('analytics.fire.assumptions.birthYearPlaceholder'),
    step: '1',
  },
  {
    key: 'coastTargetAge',
    label: t('analytics.fire.assumptions.coastAgeLabel'),
    placeholder: t('analytics.fire.assumptions.coastAgePlaceholder'),
    step: '1',
  },
]);

const moreFieldRefs: Partial<Record<NumberKey, HTMLElement>> = {};
const setMoreFieldRef = ({ key, el }: { key: NumberKey; el: Element | ComponentPublicInstance | null }) => {
  const root = el && '$el' in el ? el.$el : el;
  if (root instanceof HTMLElement) moreFieldRefs[key] = root;
  else delete moreFieldRefs[key];
};

const sectionRefs = {
  spending: useTemplateRef<HTMLElement>('spending'),
  contribution: useTemplateRef<HTMLElement>('contribution'),
  counts: useTemplateRef<HTMLElement>('counts'),
  return: useTemplateRef<HTMLElement>('return'),
};

const panel = useTemplateRef<HTMLElement>('panel');

const focusField = async ({ field }: { field: FireFocusField }) => {
  const moreKey = MORE_FIELD_BY_FOCUS[field];
  const sectionKey: AssumptionSection = moreKey ? 'more' : (field as keyof typeof sectionRefs);
  if (!openSections.value[sectionKey]) {
    openSections.value[sectionKey] = true;
    // The content grows from 0 height, so centring only lands once the open animation ends.
    await waitForAnimationEnd(panel.value, 'collapsible-down');
  }
  const section = moreKey ? moreFieldRefs[moreKey] : sectionRefs[field as keyof typeof sectionRefs].value;
  if (!section) return;
  section.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (field !== 'counts') section.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
};

defineExpose({ focusField });
</script>
