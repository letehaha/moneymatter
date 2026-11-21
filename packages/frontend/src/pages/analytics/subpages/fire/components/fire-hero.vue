<template>
  <div class="@container/hero">
    <div class="flex flex-col gap-5 @2xl/hero:flex-row @2xl/hero:items-start @2xl/hero:justify-between">
      <div v-if="plan.status === 'reached' && plan.reached" class="flex flex-col gap-2">
        <div class="text-success-text flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
          <CircleCheckIcon class="size-3.5" />
          {{ $t('analytics.fire.hero.reached.eyebrowFor', { type: targetName }) }}
        </div>
        <div class="text-3xl leading-none font-extrabold tracking-tight @lg/hero:text-4xl">
          {{ $t('analytics.fire.hero.reached.title') }}
        </div>
        <div class="text-[15px] tabular-nums">
          <i18n-t keypath="analytics.fire.hero.reached.supports" tag="span">
            <template #amount>
              <span class="font-bold">{{ formatWholeBaseCurrency(plan.reached.monthlyIncome) }}</span>
            </template>
          </i18n-t>
          <span v-if="plan.reached.pctOfSpending !== null" class="text-muted-foreground">
            ·
            {{
              $t('analytics.fire.hero.reached.pctOfSpending', {
                pct: Math.round(plan.reached.pctOfSpending),
                rate: settings.withdrawalRatePct,
              })
            }}
          </span>
        </div>
        <div v-if="yearsCovered !== null" class="text-muted-foreground text-sm tabular-nums">
          {{ $t('analytics.fire.hero.reached.yearsCovered', { n: yearsCovered }, yearsCovered) }}
        </div>
        <Callout v-if="plan.inputs.contribution <= 0" variant="info" class="mt-1 max-w-md">
          {{
            plan.inputs.contribution < 0
              ? $t('analytics.fire.hero.reached.drawdown', {
                  amount: formatWholeBaseCurrency(-plan.inputs.contribution),
                })
              : $t('analytics.fire.hero.reached.noNewSavings')
          }}
        </Callout>
      </div>

      <div v-else-if="plan.status === 'unreachable'" class="flex flex-col gap-3">
        <div class="flex flex-col gap-2">
          <div class="text-primary-text text-[11px] font-semibold tracking-wider uppercase">
            {{ $t('analytics.fire.hero.timeTo', { type: targetName }) }}
          </div>
          <div class="text-2xl leading-tight font-extrabold tracking-tight @lg/hero:text-3xl">
            {{ $t('analytics.fire.hero.unreachable.title') }}
          </div>
          <ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-4.5 text-sm">
            <li v-if="plan.inputs.contribution <= 0">
              <span class="text-foreground font-semibold">{{
                $t('analytics.fire.hero.unreachable.noSavingsTitle')
              }}</span>
              {{
                plan.warnings.includes('contribution-clamped')
                  ? $t('analytics.fire.hero.unreachable.noSavingsClamped')
                  : $t('analytics.fire.hero.unreachable.noSavings')
              }}
              <Button variant="link" class="h-auto p-0 align-baseline" @click="emit('focusField', 'contribution')">
                {{ $t('analytics.fire.hero.unreachable.enterContribution') }}
              </Button>
            </li>
            <li v-if="settings.realAnnual <= 0">
              <span class="text-foreground font-semibold">{{
                $t('analytics.fire.hero.unreachable.lowReturnTitle')
              }}</span>
              {{ $t('analytics.fire.hero.unreachable.lowReturn') }}
            </li>
            <li v-if="plan.inputs.contribution > 0 && settings.realAnnual > 0">
              {{ $t('analytics.fire.hero.unreachable.tooSlow') }}
            </li>
          </ul>
          <slot name="pace" />
        </div>
        <div
          v-if="plan.unreachable && plan.target !== null"
          class="border-primary/35 bg-primary/5 flex max-w-sm flex-col gap-1.5 rounded-lg border px-4 py-3.5"
        >
          <div class="text-primary-text text-[11px] font-semibold tracking-wider uppercase">
            {{ $t('analytics.fire.hero.unreachable.whatItTakes') }}
          </div>
          <div class="text-2xl font-extrabold tabular-nums">
            {{
              $t('analytics.fire.perMonth', {
                amount: formatWholeBaseCurrency(plan.unreachable.requiredMonthlyContribution),
              })
            }}
          </div>
          <div class="text-muted-foreground text-xs">
            {{
              $t('analytics.fire.hero.unreachable.whatItTakesDetail', {
                target: formatWholeBaseCurrency(plan.target),
                duration: formatDuration({ months: UNREACHABLE_PMT_MONTHS, t }),
              })
            }}
          </div>
        </div>
      </div>

      <div v-else-if="plan.eta" class="flex flex-col gap-1.5">
        <div class="text-primary-text flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
          <FlameIcon class="size-3.5" />
          {{ $t('analytics.fire.hero.timeTo', { type: targetName }) }}
        </div>
        <div
          class="grid grid-cols-[1fr_auto] items-end gap-x-3 @2xl/hero:flex @2xl/hero:flex-col @2xl/hero:items-start @2xl/hero:gap-1.5"
        >
          <div
            data-testid="fire-eta"
            class="text-4xl leading-none font-extrabold tracking-tight tabular-nums @lg/hero:text-[46px]"
          >
            <i18n-t
              v-if="etaParts.years > 0"
              keypath="analytics.fire.hero.unitYears"
              :plural="etaParts.years"
              tag="span"
              :class="ETA_UNIT_CLASS"
            >
              <template #n>
                <span :class="ETA_NUMBER_CLASS">{{ etaParts.years }}</span>
              </template>
            </i18n-t>
            <template v-if="etaParts.months > 0 || etaParts.years === 0">
              {{ etaParts.years > 0 ? ' ' : '' }}
              <i18n-t
                keypath="analytics.fire.hero.unitMonths"
                :plural="etaParts.months"
                tag="span"
                :class="ETA_UNIT_CLASS"
              >
                <template #n>
                  <span :class="ETA_NUMBER_CLASS">{{ etaParts.months }}</span>
                </template>
              </i18n-t>
            </template>
          </div>
          <div class="text-right text-[15px] leading-tight font-semibold @2xl/hero:text-left @2xl/hero:leading-normal">
            {{ format(plan.eta.date, 'LLLL yyyy') }}
            <span
              v-if="plan.eta.ageAtDate !== null"
              class="text-muted-foreground block text-xs font-medium @2xl/hero:inline @2xl/hero:text-[15px]"
            >
              <span class="hidden @2xl/hero:inline">· </span>
              {{ $t('analytics.fire.hero.atAge', { age: Math.floor(plan.eta.ageAtDate) }) }}
            </span>
          </div>
        </div>
        <div v-if="rangeLabel" class="text-muted-foreground text-xs @2xl/hero:text-sm">{{ rangeLabel }}</div>
        <div v-if="$slots.pace" class="mt-2"><slot name="pace" /></div>
      </div>

      <div
        class="text-muted-foreground border-border flex flex-col border-t text-sm @2xl/hero:shrink-0 @2xl/hero:items-end @2xl/hero:gap-1 @2xl/hero:border-0 @2xl/hero:text-right"
      >
        <div :class="LEDGER_ROW_CLASS">
          <i18n-t keypath="analytics.fire.hero.basedOn.spending" tag="span">
            <template #amount>
              <Button variant="link" :class="LINK_CLASS" @click="emit('focusField', 'spending')">
                {{
                  plan.inputs.spending === null
                    ? '—'
                    : $t('analytics.fire.perYear', { amount: formatWholeBaseCurrency(plan.inputs.spending) })
                }}
              </Button>
            </template>
          </i18n-t>
          <span v-if="plan.inputs.spendingIsAuto" :class="BADGE_CLASS">{{ $t('analytics.fire.auto') }}</span>
        </div>
        <div :class="LEDGER_ROW_CLASS">
          <i18n-t keypath="analytics.fire.hero.basedOn.saving" tag="span">
            <template #amount>
              <Button variant="link" :class="LINK_CLASS" @click="emit('focusField', 'contribution')">
                {{ $t('analytics.fire.perMonth', { amount: formatWholeBaseCurrency(plan.inputs.contribution) }) }}
              </Button>
            </template>
          </i18n-t>
          <span v-if="plan.inputs.contributionIsAuto" :class="BADGE_CLASS">{{ $t('analytics.fire.auto') }}</span>
        </div>
        <i18n-t keypath="analytics.fire.hero.basedOn.counting" tag="div" :class="LEDGER_ROW_CLASS">
          <template #buckets>
            <span class="inline-flex items-center gap-1.5 align-middle">
              <DesktopOnlyTooltip v-for="source in TOGGLE_SOURCES" :key="source.key" :content="$t(source.labelKey)">
                <Button
                  variant="outline"
                  size="icon-sm"
                  :class="cn(CHIP_CLASS, settings[source.key] ? CHIP_ON_CLASS : 'text-muted-foreground opacity-40')"
                  :aria-label="$t(source.labelKey)"
                  :aria-pressed="settings[source.key]"
                  @click="emit('toggleSource', source.key)"
                >
                  <component :is="source.icon" class="size-3.5" />
                </Button>
              </DesktopOnlyTooltip>
              <span aria-hidden="true" class="bg-border mx-0.5 h-4 w-px" />
              <DesktopOnlyTooltip
                v-for="source in FIXED_SOURCES"
                :key="source.labelKey"
                :content="`${$t(source.labelKey)} · ${$t('analytics.fire.hero.alwaysCounted')}`"
              >
                <span
                  role="img"
                  :aria-label="$t(source.labelKey)"
                  :class="
                    cn(CHIP_CLASS, CHIP_ON_CLASS, 'inline-flex cursor-default items-center justify-center border')
                  "
                >
                  <component :is="source.icon" class="size-3.5" />
                </span>
              </DesktopOnlyTooltip>
            </span>
          </template>
        </i18n-t>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { type FirePlan, UNREACHABLE_PMT_MONTHS } from '@/composable/fire/build-fire-plan';
import { HORIZON_MONTHS, monthsToLabel, yearsOfSpendingCovered } from '@/composable/fire/fire-math';
import type { ResolvedFireSettings } from '@/composable/fire/resolve-fire-settings';
import { useDateLocale } from '@/composable/use-date-locale';
import { formatDuration } from '@/js/helpers/format-duration';
import { cn } from '@/lib/utils';
import {
  CarIcon,
  ChartLineIcon,
  CircleCheckIcon,
  FlameIcon,
  HandshakeIcon,
  LandmarkIcon,
  WalletIcon,
} from '@lucide/vue';
import { getYear } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { FireToggleSource } from './fire-assumptions.vue';

const MONTHS_PER_YEAR = 12;
const LINK_CLASS = 'h-auto p-0 align-baseline font-semibold underline decoration-dotted underline-offset-3';
const LEDGER_ROW_CLASS =
  'border-border flex items-center justify-between gap-3 border-b py-2 @2xl/hero:block @2xl/hero:border-0 @2xl/hero:py-0';
const BADGE_CLASS = 'border-border @2xl/hero:ml-1.5 rounded-full border px-1.5 py-px text-[11px]';
const CHIP_CLASS = 'size-6.5 rounded-full';
const CHIP_ON_CLASS = 'border-primary/40 bg-primary/10 text-primary-text';
const ETA_UNIT_CLASS = 'text-muted-foreground text-xl font-semibold';
const ETA_NUMBER_CLASS = 'text-foreground text-4xl font-extrabold @lg/hero:text-[46px]';

const TOGGLE_SOURCES = [
  { key: 'includeVentures', icon: HandshakeIcon, labelKey: 'analytics.fire.assumptions.countsVentures' },
  { key: 'includeVehicles', icon: CarIcon, labelKey: 'analytics.fire.assumptions.countsVehicles' },
  { key: 'includeLoans', icon: LandmarkIcon, labelKey: 'analytics.fire.assumptions.countsLoans' },
] as const;

const FIXED_SOURCES = [
  { icon: WalletIcon, labelKey: 'analytics.fire.assumptions.countsCash' },
  { icon: ChartLineIcon, labelKey: 'analytics.fire.assumptions.countsPortfolios' },
] as const;

const props = defineProps<{ plan: FirePlan; settings: ResolvedFireSettings; targetName: string }>();
const emit = defineEmits<{
  focusField: [field: 'spending' | 'contribution'];
  toggleSource: [key: FireToggleSource];
}>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatWholeBaseCurrency } = useFormatCurrency();

const etaParts = computed(() => monthsToLabel({ months: props.plan.eta?.months ?? 0 }));

const rangeLabel = computed(() => {
  const { range } = props.plan;
  if (range === null) return null;
  const earliest = format(range.earliest.date, 'LLL yyyy');
  if (range.latest === null)
    return t('analytics.fire.hero.rangeOpen', {
      earliest,
      year: getYear(new Date()) + HORIZON_MONTHS / MONTHS_PER_YEAR,
    });
  const latest = format(range.latest.date, 'LLL yyyy');
  return earliest === latest ? null : t('analytics.fire.hero.range', { earliest, latest });
});

const yearsCovered = computed(() => {
  const { spending, balance } = props.plan.inputs;
  const years = spending === null ? null : yearsOfSpendingCovered({ balance, annualSpending: spending });
  return years === null ? null : Math.floor(years);
});
</script>
