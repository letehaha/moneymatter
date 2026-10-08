<script setup lang="ts">
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { type FireMilestone, type FireWarning, UNREACHABLE_PMT_MONTHS } from '@/composable/fire/build-fire-plan';
import { displayProgressPct } from '@/composable/fire/fire-display';
import { monthsToLabel } from '@/composable/fire/fire-math';
import { useFirePlan, useResolvedFireSettings } from '@/composable/fire/use-fire-plan';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { formatDuration } from '@/js/helpers/format-duration';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { FEATURES } from '@bt/shared/types';
import { ArrowUpRightIcon, CheckIcon, FlameIcon, LockIcon, TargetIcon, TriangleAlertIcon } from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { type Ref, computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import ErrorState from '../components/error-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import FirePath from './fire-path.vue';
import FireRing from './fire-ring.vue';

defineOptions({ name: 'fire-progress-widget' });

const LEDGER_ROW_CLASS = 'border-border flex items-baseline justify-between gap-3 border-t py-1.5';
const HERO_WITH_PCT_CLASS = 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1';

const { t } = useI18n();
const { format } = useDateLocale();
const { formatWholeBaseCurrency, formatCompactBaseCurrency: compact } = useFormatCurrency();

const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const isNumbers = computed(() => widgetConfigRef?.value?.config?.style === 'numbers');
const isWide = computed(() => (widgetConfigRef?.value?.colSpan ?? 1) >= 2);
const showPath = computed(() => isNumbers.value && isWide.value);

const userStore = useUserStore();
const isGated = computed(() => userStore.isFeatureGated(FEATURES.fire_planner));

const {
  data: userSettings,
  isLoading: isUserSettingsLoading,
  isError: isUserSettingsError,
  refetch: refetchUserSettings,
} = useUserSettings();
const {
  settings,
  isLoading: isReturnsLoading,
  isError: isReturnsError,
  refetch: refetchReturns,
} = useResolvedFireSettings({ fire: () => userSettings.value?.fire, enabled: () => !isGated.value });
const {
  plan,
  isError: isPlanError,
  refetch: refetchPlan,
} = useFirePlan({
  settings,
  includeHistory: showPath,
  enabled: () => !isGated.value,
});

const fireRoute = { name: ROUTES_NAMES.analyticsFire };

const isLoading = computed(
  () => isUserSettingsLoading.value || isReturnsLoading.value || plan.value.status === 'loading',
);
const hasError = computed(() => isPlanError.value || isReturnsError.value || isUserSettingsError.value);
const retry = () => {
  refetchPlan();
  refetchReturns();
  if (isUserSettingsError.value) refetchUserSettings();
};
const needsSetup = computed(() => plan.value.status === 'no-data' || plan.value.status === 'needs-spending');

const pct = computed(() =>
  Math.min(
    100,
    Math.floor(displayProgressPct({ ratio: plan.value.progress ?? 0, reached: plan.value.status === 'reached' })),
  ),
);
const tone = computed<'primary' | 'success' | 'warning'>(() => {
  if (plan.value.status === 'reached') return 'success';
  if (plan.value.status === 'unreachable') return 'warning';
  return 'primary';
});

const durationLeft = computed(() =>
  plan.value.eta === null ? '' : formatDuration({ months: plan.value.eta.months, t }),
);
const etaParts = computed(() => monthsToLabel({ months: plan.value.eta?.months ?? 0 }));
const etaMonth = computed(() => (plan.value.eta === null ? '' : format(plan.value.eta.date, 'LLLL yyyy')));
const age = computed(() =>
  plan.value.eta === null || plan.value.eta.ageAtDate === null ? null : Math.floor(plan.value.eta.ageAtDate),
);

const targetName = computed(() => t(`common.fire.targets.${settings.value.targetType}`));

const ringLabel = computed(() => {
  const type = targetName.value;
  if (plan.value.status === 'reached') return t('widgets.fireProgress.ringLabelReachedFor', { type });
  if (plan.value.status === 'unreachable')
    return t('widgets.fireProgress.ringLabelUnreachableFor', { pct: pct.value, type });
  return t('widgets.fireProgress.ringLabelFor', { pct: pct.value, type, duration: durationLeft.value });
});

const nextMilestone = computed(() => {
  const next = plan.value.nextMilestone;
  if (next === null || next.hitMonth === null || next.date === null) return null;
  return {
    pct: next.pct,
    duration: formatDuration({ months: next.hitMonth, t }),
    month: format(next.date, 'LLL yyyy'),
  };
});
const reachedMilestones = computed(() => plan.value.milestones.filter((m) => m.reached).length);
const isCoastReached = computed(() => plan.value.chips.some((c) => c.key === 'coast' && c.status === 'reached'));

const milestoneMonth = ({ m }: { m: FireMilestone }) => {
  if (m.date !== null) return format(m.date, 'LLL yyyy');
  return m.reached ? t('widgets.fireProgress.reached') : '—';
};

const milestoneNodes = computed(() =>
  plan.value.milestones.map((m) => ({
    pct: m.pct,
    reached: m.reached,
    label: m.pct === 100 ? targetName.value : `${m.pct}%`,
    month: milestoneMonth({ m }),
    eta:
      m.reached || m.hitMonth === null
        ? null
        : t('widgets.fireProgress.milestoneIn', { pct: m.pct, duration: formatDuration({ months: m.hitMonth, t }) }),
  })),
);

const segmentFill = ({ index }: { index: number }) => {
  const from = plan.value.milestones[index - 1]?.pct ?? 0;
  const to = plan.value.milestones[index]?.pct ?? 100;
  return Math.min(1, Math.max(0, (pct.value - from) / (to - from)));
};

const dotClass = ({ done, isFire }: { done: boolean; isFire?: boolean }) =>
  cn(
    'border-muted-foreground/40 size-2.5 shrink-0 rounded-full border-2',
    isFire && 'border-primary-text',
    done && 'bg-success-text border-success-text',
  );

const RETURN_WARNING_KEYS: Partial<Record<FireWarning, string>> = {
  'portfolio-unavailable': 'analytics.fire.callouts.portfolioUnavailable',
  'custom-missing': 'analytics.fire.callouts.customMissing',
};
const returnWarning = computed(() => {
  const key = plan.value.warnings.map((w) => RETURN_WARNING_KEYS[w]).find((k) => k !== undefined);
  return key === undefined ? null : t(key);
});

const balanceOfTarget = computed(() =>
  plan.value.target === null
    ? ''
    : t('widgets.fireProgress.balanceOfTarget', {
        balance: compact({ amount: plan.value.inputs.balance }),
        target: compact({ amount: plan.value.target }),
      }),
);
const milestonesSummary = computed(() =>
  t('widgets.fireProgress.milestonesReached', { n: reachedMilestones.value, total: plan.value.milestones.length }),
);

const pmtDuration = computed(() => formatDuration({ months: UNREACHABLE_PMT_MONTHS, t }));

const [DefineHero, ReuseHero] = createReusableTemplate<{ numberClass: string; unitClass: string; withPct?: boolean }>();
const [DefineHeroPct, ReuseHeroPct] = createReusableTemplate();
const [DefineLedger, ReuseLedger] = createReusableTemplate();
const [DefineTimeline, ReuseTimeline] = createReusableTemplate();
const [DefineStepper, ReuseStepper] = createReusableTemplate();
const [DefineSkeletonRows, ReuseSkeletonRows] = createReusableTemplate();
const [DefineSkeletonDots, ReuseSkeletonDots] = createReusableTemplate();
</script>

<template>
  <WidgetWrapper class="@container">
    <template #title>{{ $t('widgets.fireProgress.title') }}</template>

    <template v-if="!isGated && !needsSetup" #action>
      <span v-if="isLoading" class="size-8" aria-hidden="true" />
      <DesktopOnlyTooltip v-else :content="$t('widgets.fireProgress.openPlan')">
        <span class="inline-flex">
          <Button as-child variant="ghost" size="icon-sm" class="text-muted-foreground">
            <RouterLink :to="fireRoute" :aria-label="$t('widgets.fireProgress.openPlan')">
              <ArrowUpRightIcon class="size-4" />
            </RouterLink>
          </Button>
        </span>
      </DesktopOnlyTooltip>
    </template>

    <DefineHeroPct>
      <p
        class="text-muted-foreground col-start-2 row-start-1 text-right text-[11px] font-semibold tracking-widest uppercase"
      >
        {{ $t('widgets.fireProgress.progress') }}
      </p>
      <p class="col-start-2 row-start-2 text-right text-3xl leading-none font-extrabold tracking-tight tabular-nums">
        {{ pct }}<span class="text-muted-foreground text-lg font-semibold tracking-normal">%</span>
      </p>
    </DefineHeroPct>

    <DefineHero v-slot="{ numberClass, unitClass, withPct }">
      <div v-if="plan.status === 'reached' && plan.reached" class="flex flex-col gap-1">
        <p class="text-success-text flex items-center gap-1.5 text-lg font-extrabold">
          <CheckIcon class="size-5 shrink-0" :stroke-width="3" />
          {{ $t('widgets.fireProgress.reachedType', { type: targetName }) }}
        </p>
        <p class="text-muted-foreground text-xs tabular-nums">
          <i18n-t keypath="widgets.fireProgress.supports" tag="span">
            <template #amount>
              <b class="text-foreground">{{ formatWholeBaseCurrency(plan.reached.monthlyIncome) }}</b>
            </template>
          </i18n-t>
          <template v-if="plan.reached.pctOfSpending !== null">
            · {{ $t('widgets.fireProgress.pctOfSpending', { pct: Math.round(plan.reached.pctOfSpending) }) }}
          </template>
        </p>
      </div>

      <div
        v-else-if="plan.status === 'unreachable' && plan.unreachable"
        :class="withPct ? HERO_WITH_PCT_CLASS : 'flex flex-col gap-1'"
      >
        <p class="text-warning-text col-start-1 font-bold">{{ $t('widgets.fireProgress.unreachable') }}</p>
        <i18n-t
          keypath="widgets.fireProgress.needs"
          tag="p"
          class="text-muted-foreground col-start-1 text-xs tabular-nums"
        >
          <template #amount>
            <b class="text-foreground">{{ formatWholeBaseCurrency(plan.unreachable.requiredMonthlyContribution) }}</b>
          </template>
          <template #duration>{{ pmtDuration }}</template>
        </i18n-t>
        <ReuseHeroPct v-if="withPct" />
      </div>

      <div v-else-if="plan.eta" :class="withPct ? HERO_WITH_PCT_CLASS : 'flex flex-col gap-1'">
        <p
          class="text-primary-text col-start-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase"
        >
          <FlameIcon class="size-3.5" />
          {{ $t('widgets.fireProgress.timeTo', { type: targetName }) }}
        </p>
        <p
          :class="
            cn(
              'col-start-1 flex flex-wrap items-baseline gap-x-2 leading-none font-extrabold tracking-tight tabular-nums',
              numberClass,
            )
          "
        >
          <i18n-t
            v-if="etaParts.years > 0"
            keypath="widgets.fireProgress.unitYears"
            :plural="etaParts.years"
            tag="span"
            :class="cn('text-muted-foreground font-semibold tracking-normal whitespace-nowrap', unitClass)"
          >
            <template #n>
              <span class="text-foreground font-extrabold tracking-tight">{{ etaParts.years }}</span>
            </template>
          </i18n-t>
          <i18n-t
            v-if="etaParts.months > 0 || etaParts.years === 0"
            keypath="widgets.fireProgress.unitMonths"
            :plural="etaParts.months"
            tag="span"
            :class="cn('text-muted-foreground font-semibold tracking-normal whitespace-nowrap', unitClass)"
          >
            <template #n>
              <span class="text-foreground font-extrabold tracking-tight">{{ etaParts.months }}</span>
            </template>
          </i18n-t>
        </p>
        <p class="text-muted-foreground col-span-full text-sm">
          {{ etaMonth }}
          <template v-if="age !== null">· {{ $t('widgets.fireProgress.atAge', { age }) }}</template>
          <DesktopOnlyTooltip v-if="returnWarning" :content="returnWarning">
            <span class="inline-flex align-middle">
              <TriangleAlertIcon class="text-warning-text size-3.5" role="img" :aria-label="returnWarning" />
            </span>
          </DesktopOnlyTooltip>
        </p>
        <ReuseHeroPct v-if="withPct" />
      </div>
    </DefineHero>

    <DefineLedger>
      <dl class="text-xs tabular-nums">
        <div v-if="plan.target !== null" :class="LEDGER_ROW_CLASS">
          <dt class="text-muted-foreground">{{ $t('widgets.fireProgress.saved') }}</dt>
          <dd class="text-right font-bold">{{ balanceOfTarget }}</dd>
        </div>
        <div v-if="nextMilestone" :class="LEDGER_ROW_CLASS">
          <dt class="text-muted-foreground">{{ $t('widgets.fireProgress.nextMilestone') }}</dt>
          <dd class="text-right font-bold">
            {{ $t('widgets.fireProgress.milestoneIn', nextMilestone) }}
            <span class="text-muted-foreground font-medium">· {{ nextMilestone.month }}</span>
          </dd>
        </div>
        <div v-if="plan.target !== null" :class="LEDGER_ROW_CLASS">
          <dt class="text-muted-foreground">{{ $t('widgets.fireProgress.typeNumber', { type: targetName }) }}</dt>
          <dd class="text-right font-bold">
            {{ compact({ amount: plan.target }) }}
            <span class="text-muted-foreground font-medium">
              {{ $t('widgets.fireProgress.atRate', { rate: settings.withdrawalRatePct.toFixed(1) }) }}
            </span>
          </dd>
        </div>
        <div v-if="isCoastReached" :class="LEDGER_ROW_CLASS">
          <dt class="text-muted-foreground">{{ $t('widgets.fireProgress.coastFire') }}</dt>
          <dd class="text-success-text inline-flex items-center gap-1 font-bold">
            <CheckIcon class="size-3.5" :stroke-width="3" />
            {{ $t('widgets.fireProgress.reached') }}
          </dd>
        </div>
      </dl>
    </DefineLedger>

    <DefineTimeline>
      <div class="text-muted-foreground relative h-13 text-[11px] leading-tight tabular-nums">
        <span class="border-border absolute inset-x-1.25 top-1 border-t-2 border-dashed" aria-hidden="true" />
        <span
          class="bg-primary-text absolute top-1 left-1.25 h-0.5 rounded-full"
          :style="{ width: `calc((100% - 0.625rem) * ${pct / 100})` }"
          aria-hidden="true"
        />
        <ol class="absolute inset-0" :aria-label="milestonesSummary">
          <li class="absolute top-0 left-0 flex flex-col items-start gap-1.5">
            <span class="bg-primary-text border-primary-text size-2.5 rounded-full border-2" />
            <b class="text-foreground text-xs">{{ $t('widgets.fireProgress.chart.today') }}</b>
            <span>{{ pct }}%</span>
          </li>
          <li
            v-for="(m, i) in milestoneNodes"
            :key="m.pct"
            :class="
              cn(
                'absolute top-0 flex flex-col gap-1.5 text-center whitespace-nowrap',
                i === milestoneNodes.length - 1
                  ? '-translate-x-full items-end text-right'
                  : '-translate-x-1/2 items-center',
              )
            "
            :style="{ left: `${((i + 1) / milestoneNodes.length) * 100}%` }"
          >
            <span :class="dotClass({ done: m.reached, isFire: m.pct === 100 })" />
            <b class="text-foreground text-xs">{{ m.label }}</b>
            <span>{{ m.month }}</span>
          </li>
        </ol>
      </div>
    </DefineTimeline>

    <DefineSkeletonRows>
      <div class="flex-col">
        <div v-for="i in 3" :key="i" class="border-t py-2">
          <div class="bg-muted h-3 w-full rounded" />
        </div>
      </div>
    </DefineSkeletonRows>

    <DefineSkeletonDots>
      <div class="flex justify-between">
        <div v-for="i in 5" :key="i" class="flex flex-col items-center gap-1.5">
          <span class="bg-muted size-2.5 rounded-full" />
          <div class="bg-muted h-3 w-8 rounded" />
          <div class="bg-muted h-2.5 w-10 rounded" />
        </div>
      </div>
    </DefineSkeletonDots>

    <DefineStepper>
      <ol class="text-xs tabular-nums" :aria-label="milestonesSummary">
        <li class="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pb-2.5">
          <span class="border-border absolute top-3.5 bottom-0 left-1 border-l-2 border-dashed" aria-hidden="true" />
          <span
            class="bg-primary-text absolute top-3.5 left-0.75 w-0.5 rounded-full"
            :style="{ height: `calc((100% - 0.875rem) * ${segmentFill({ index: 0 })})` }"
            aria-hidden="true"
          />
          <span class="bg-primary-text border-primary-text mt-0.75 size-2.5 rounded-full border-2" />
          <span>
            <b class="block">{{ $t('widgets.fireProgress.chart.today') }}</b>
            <span class="text-muted-foreground">{{ pct }}% · {{ balanceOfTarget }}</span>
          </span>
        </li>
        <li
          v-for="(m, i) in milestoneNodes"
          :key="m.pct"
          class="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pb-2.5 last:pb-0"
        >
          <template v-if="i < milestoneNodes.length - 1">
            <span class="border-border absolute top-3.5 bottom-0 left-1 border-l-2 border-dashed" aria-hidden="true" />
            <span
              class="bg-primary-text absolute top-3.5 left-0.75 w-0.5 rounded-full"
              :style="{ height: `calc((100% - 0.875rem) * ${segmentFill({ index: i + 1 })})` }"
              aria-hidden="true"
            />
          </template>
          <span :class="cn(dotClass({ done: m.reached, isFire: m.pct === 100 }), 'mt-0.75')" />
          <span>
            <b class="block">{{ m.eta ?? m.label }}</b>
            <span class="text-muted-foreground">{{ m.month }}</span>
          </span>
        </li>
      </ol>
    </DefineStepper>

    <div v-if="isGated" class="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span class="bg-primary/10 text-primary-text flex size-12 items-center justify-center rounded-full">
        <LockIcon class="size-6" />
      </span>
      <p class="font-bold">{{ $t('widgets.fireProgress.locked.title') }}</p>
      <p class="text-muted-foreground max-w-64 text-xs">{{ $t('widgets.fireProgress.locked.description') }}</p>
      <Button as-child size="sm" class="mt-1">
        <RouterLink :to="fireRoute">
          {{ $t('widgets.fireProgress.locked.action') }}
        </RouterLink>
      </Button>
    </div>

    <div
      v-else-if="isLoading && isNumbers"
      :class="
        cn(
          'flex h-full animate-pulse flex-col justify-center gap-4',
          showPath && '@2xl:grid @2xl:grid-cols-[18rem_minmax(0,1fr)] @2xl:gap-7',
        )
      "
      aria-busy="true"
    >
      <div class="flex flex-col justify-center gap-4">
        <div class="flex flex-col gap-1">
          <div class="bg-muted my-0.5 h-3 w-24 rounded" />
          <div class="bg-muted my-1 h-9 w-40 rounded @2xs:h-11" />
          <div class="bg-muted my-0.5 h-4 w-32 rounded" />
        </div>
        <div :class="cn('flex flex-col gap-3', showPath && '@2xl:hidden')">
          <ReuseSkeletonDots />
          <div class="border-t pt-2.5">
            <div class="bg-muted my-0.5 h-3 w-full rounded" />
          </div>
        </div>
        <ReuseSkeletonRows v-if="showPath" class="hidden @2xl:flex" />
      </div>
      <div v-if="showPath" class="bg-muted h-30 rounded @2xl:h-auto @2xl:min-h-24 @2xl:self-stretch" />
    </div>

    <div
      v-else-if="isLoading"
      :class="
        cn(
          'flex h-full animate-pulse flex-col justify-center gap-4',
          isWide && '@3xl:grid @3xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.1fr)] @3xl:items-center @3xl:gap-8',
        )
      "
      aria-busy="true"
    >
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 @sm:gap-5 @3xl:contents">
        <div class="border-muted size-26 rounded-full border-10 @sm:size-36 @3xl:size-44" />
        <div class="flex min-w-0 flex-col gap-3">
          <div class="flex flex-col gap-1">
            <div class="bg-muted my-0.5 h-3 w-24 rounded" />
            <div class="bg-muted my-1 h-6 w-36 rounded @sm:h-7 @3xl:h-9" />
            <div class="bg-muted my-0.5 h-4 w-32 rounded" />
          </div>
          <ReuseSkeletonRows class="hidden @sm:flex" />
        </div>
      </div>
      <ReuseSkeletonRows class="flex @sm:hidden" />
      <div v-if="isWide" class="flex flex-col gap-3 @3xl:justify-center @3xl:self-stretch @3xl:border-l @3xl:pl-8">
        <div class="bg-muted my-0.5 h-3 w-28 rounded" />
        <ReuseSkeletonDots class="@3xl:hidden" />
        <div class="hidden flex-col gap-3 @3xl:flex">
          <div v-for="i in 5" :key="i" class="flex items-center gap-3">
            <span class="bg-muted size-2.5 rounded-full" />
            <div class="bg-muted h-3 w-40 rounded" />
          </div>
        </div>
      </div>
    </div>

    <ErrorState v-else-if="hasError" :message="$t('widgets.fireProgress.loadFailed')" @retry="retry" />

    <div v-else-if="needsSetup" class="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span class="bg-primary/10 text-primary-text flex size-12 items-center justify-center rounded-full">
        <TargetIcon class="size-6" />
      </span>
      <p class="font-bold">{{ $t('widgets.fireProgress.setup.title') }}</p>
      <p class="text-muted-foreground max-w-64 text-xs">{{ $t('widgets.fireProgress.setup.description') }}</p>
      <Button as-child size="sm" class="mt-1">
        <RouterLink :to="fireRoute">{{ $t('widgets.fireProgress.setup.action') }}</RouterLink>
      </Button>
    </div>

    <RouterLink
      v-else-if="isNumbers"
      :to="fireRoute"
      :class="
        cn(
          'focus-visible:ring-ring flex h-full flex-col justify-center gap-4 rounded-md outline-none focus-visible:ring-2',
          showPath && '@2xl:grid @2xl:grid-cols-[18rem_minmax(0,1fr)] @2xl:gap-7',
        )
      "
    >
      <div class="flex min-w-0 flex-col justify-center gap-4">
        <ReuseHero
          :number-class="showPath ? 'text-4xl @2xs:text-5xl @2xl:text-4xl' : 'text-4xl @2xs:text-5xl'"
          unit-class="text-lg"
          :with-pct="true"
        />

        <div :class="cn('flex flex-col gap-3', showPath && '@2xl:hidden')">
          <ReuseTimeline v-if="plan.target !== null" />
          <p
            v-if="plan.target !== null"
            class="text-muted-foreground border-border flex justify-between gap-3 border-t pt-2.5 text-xs tabular-nums"
          >
            <span>{{ balanceOfTarget }}</span>
            <span>
              {{ $t('widgets.fireProgress.typeNumber', { type: targetName }) }}
              <b class="text-foreground">{{ compact({ amount: plan.target }) }}</b>
              {{ $t('widgets.fireProgress.atRate', { rate: settings.withdrawalRatePct.toFixed(1) }) }}
            </span>
          </p>
        </div>

        <ReuseLedger v-if="showPath" class="hidden @2xl:block" />
      </div>

      <div
        v-if="showPath && plan.chart && plan.target !== null"
        class="h-30 min-w-0 @2xl:h-auto @2xl:min-h-24 @2xl:self-stretch"
      >
        <FirePath
          :chart="plan.chart"
          :target-label="
            $t('widgets.fireProgress.chart.typeTarget', { type: targetName, amount: compact({ amount: plan.target }) })
          "
        />
      </div>
    </RouterLink>

    <RouterLink
      v-else
      :to="fireRoute"
      :class="
        cn(
          'focus-visible:ring-ring flex h-full flex-col justify-center gap-4 rounded-md outline-none focus-visible:ring-2',
          isWide && '@3xl:grid @3xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.1fr)] @3xl:items-center @3xl:gap-8',
        )
      "
    >
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 @sm:gap-5 @3xl:contents">
        <FireRing :pct="pct" :tone="tone" :label="ringLabel" class="size-26 @sm:size-36 @3xl:size-44">
          <CheckIcon v-if="plan.status === 'reached'" class="text-success-text size-10 @sm:size-14" :stroke-width="3" />
          <template v-else>
            <span class="text-xl font-extrabold tabular-nums @sm:text-3xl">{{ pct }}%</span>
            <span class="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase @sm:text-[11px]">
              {{ $t('widgets.fireProgress.toType', { type: targetName }) }}
            </span>
          </template>
        </FireRing>
        <div class="flex min-w-0 flex-col gap-3">
          <ReuseHero number-class="text-2xl @sm:text-3xl @3xl:text-4xl" unit-class="text-sm @3xl:text-base" />
          <ReuseLedger class="hidden @sm:block" />
        </div>
      </div>
      <ReuseLedger class="@sm:hidden" />

      <div
        v-if="isWide && plan.target !== null"
        class="@3xl:border-border flex flex-col justify-center gap-3 @3xl:self-stretch @3xl:border-l @3xl:pl-8"
      >
        <p class="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">{{ milestonesSummary }}</p>
        <ReuseTimeline class="@3xl:hidden" />
        <ReuseStepper class="hidden @3xl:block" />
      </div>
    </RouterLink>
  </WidgetWrapper>
</template>
