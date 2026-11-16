<template>
  <div data-testid="fire-types" class="@container/chips">
    <DefineRow v-slot="{ row: { chip, targetType, selected, isNextGoal, action }, compact }">
      <component
        :is="targetType ? Button : 'div'"
        v-bind="targetType ? { variant: 'ghost', 'aria-pressed': selected } : {}"
        :class="
          cn(
            'h-auto w-full min-w-0 rounded-lg border text-left font-normal whitespace-normal',
            compact
              ? 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 px-3 py-2.5'
              : 'flex flex-col items-stretch justify-start gap-1 p-3 break-words',
            borderClass({ chip, selected }),
            targetType && (selected ? 'hover:bg-primary/10' : 'hover:bg-hover'),
            chip.status === 'waiting-spending' && 'opacity-55',
          )
        "
        @click="targetType && emit('selectTarget', targetType)"
      >
        <span
          :class="
            cn(
              'text-xs',
              selected || isNextGoal ? 'text-primary-text font-bold' : 'text-muted-foreground font-semibold',
            )
          "
        >
          {{
            isNextGoal
              ? $t('analytics.fire.chips.nextGoal', { name: $t(`analytics.fire.chips.${chip.key}.name`) })
              : $t(`analytics.fire.chips.${chip.key}.name`)
          }}
        </span>
        <span
          :class="
            cn(
              'text-lg font-bold tabular-nums',
              compact && 'text-right',
              chip.amount === null && 'text-muted-foreground',
            )
          "
        >
          {{ chip.amount === null ? '—' : formatCompact({ amount: chip.amount }) }}
        </span>
        <span class="text-muted-foreground text-[11px]">{{ description({ chip }) }}</span>
        <span :class="cn('text-xs font-semibold tabular-nums', compact ? 'text-right' : 'mt-1')">
          <span v-if="chip.status === 'reached'" class="text-success-text inline-flex items-center gap-1 font-bold">
            <CircleCheckIcon class="size-3.5 shrink-0" />
            {{ reachedText({ chip }) }}
          </span>
          <span v-else-if="chip.status === 'eta' && chip.hitMonth !== null">
            <template v-if="isNextGoal && chip.amount !== null">
              {{ progressLabel({ amount: chip.amount }) }} ·
            </template>
            {{ $t('analytics.fire.chips.eta', { duration: formatDuration({ months: chip.hitMonth, t }) }) }}
            <span v-if="plan.inputs.contribution === 0" class="text-muted-foreground font-medium">
              · {{ $t('analytics.fire.chips.growthOnly') }}
            </span>
          </span>
          <span v-else-if="chip.status === 'unreachable'" class="text-warning-text">
            {{ $t('analytics.fire.notWithinHorizon') }}
          </span>
          <Button
            v-else-if="action && !targetType"
            variant="link"
            :class="
              cn('h-auto p-0 text-xs font-semibold', chip.status === 'waiting-spending' && 'text-muted-foreground')
            "
            @click="emit('focusField', action.field)"
          >
            {{ action.label }}
          </Button>
        </span>
      </component>
    </DefineRow>

    <ul class="hidden grid-cols-6 gap-2.5 @lg/chips:grid @3xl/chips:grid-cols-5">
      <li
        v-for="row in rows"
        :key="row.chip.key"
        :class="cn('flex min-w-0 @3xl/chips:col-span-1', row.targetType ? 'col-span-2' : 'col-span-3')"
      >
        <ReuseRow :row="row" :compact="false" />
      </li>
    </ul>

    <div class="flex flex-col gap-2 @lg/chips:hidden">
      <ul v-if="selectedRow">
        <li>
          <ReuseRow :row="selectedRow" compact />
        </li>
      </ul>
      <Collapsible v-model:open="othersOpen">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="sm" class="text-muted-foreground w-full justify-between px-2 font-semibold">
            {{ $t('analytics.fire.chips.others') }}
            <ChevronDownIcon :class="cn('size-4 transition-transform', othersOpen && 'rotate-180')" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul class="flex flex-col gap-2 pt-1">
            <li v-for="row in otherRows" :key="row.chip.key">
              <ReuseRow :row="row" compact />
            </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useFormatCurrency } from '@/composable';
import type { FireChip, FirePlan } from '@/composable/fire/build-fire-plan';
import type { ResolvedFireSettings } from '@/composable/fire/resolve-fire-settings';
import { formatDuration } from '@/js/helpers/format-duration';
import { cn } from '@/lib/utils';
import { FIRE_TARGET_TYPES, type FireTargetType } from '@bt/shared/types';
import { ChevronDownIcon, CircleCheckIcon } from '@lucide/vue';
import { createReusableTemplate, useLocalStorage } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatProgressPct } from '@/composable/fire/fire-display';

import type { FireFocusField } from './fire-assumptions.vue';

type ChipField = Extract<FireFocusField, 'barista' | 'birthYear' | 'coastAge' | 'return' | 'spending'>;

const props = defineProps<{ plan: FirePlan; settings: ResolvedFireSettings }>();
const emit = defineEmits<{ focusField: [field: ChipField]; selectTarget: [type: FireTargetType] }>();

const { t } = useI18n();
const { formatWholeBaseCurrency, formatCompactBaseCurrency: formatCompact } = useFormatCurrency();

const toPct = ({ multiplier }: { multiplier: number }) => Math.round(multiplier * 100);

const borderClass = ({ chip, selected }: { chip: FireChip; selected: boolean }) => {
  if (selected) return 'border-primary ring-primary bg-primary/5 ring-1';
  if (chip.status === 'reached') return 'border-success-text/35 bg-success-text/5';
  if (chip.status === 'needs-input') return 'border-dashed';
  return 'border-border';
};

const chipAction = ({ chip }: { chip: FireChip }): { field: ChipField; label: string } | null => {
  switch (chip.status) {
    case 'waiting-spending':
      return { field: 'spending', label: t('analytics.fire.chips.actions.enterSpending') };
    case 'past-coast-age':
      return { field: 'coastAge', label: t('analytics.fire.chips.actions.changeCoastAge') };
    case 'not-meaningful':
      return { field: 'return', label: t('analytics.fire.chips.actions.changeReturn') };
    case 'needs-input':
      return chip.key === 'barista'
        ? { field: 'barista', label: t('analytics.fire.chips.actions.addPartTimeIncome') }
        : { field: 'birthYear', label: t('analytics.fire.chips.actions.addBirthYear') };
    default:
      return null;
  }
};

const rows = computed(() =>
  props.plan.chips.map((chip) => {
    const targetType = FIRE_TARGET_TYPES.find((type) => type === chip.key) ?? null;
    return {
      chip,
      targetType,
      selected: targetType !== null && targetType === props.settings.targetType,
      isNextGoal: chip.key === props.plan.nextGoal,
      action: chipAction({ chip }),
    };
  }),
);

const selectedRow = computed(() => rows.value.find((row) => row.selected));
const otherRows = computed(() => rows.value.filter((row) => !row.selected));

const [DefineRow, ReuseRow] = createReusableTemplate<{ row: (typeof rows.value)[number]; compact: boolean }>({
  inheritAttrs: false,
});

const othersOpen = useLocalStorage<boolean>('fire:other-types-open', false);

const progressLabel = ({ amount }: { amount: number }) =>
  formatProgressPct({ ratio: props.plan.inputs.balance / amount, reached: false });

const description = ({ chip }: { chip: FireChip }) => {
  const { settings } = props;
  switch (chip.key) {
    case 'lean':
      return t('analytics.fire.chips.lean.description', { pct: toPct({ multiplier: settings.leanMultiplier }) });
    case 'regular':
      return t('analytics.fire.chips.regular.description');
    case 'fat':
      return t('analytics.fire.chips.fat.description', { pct: toPct({ multiplier: settings.fatMultiplier }) });
    case 'barista':
      return settings.baristaMonthlyIncome === null
        ? t('analytics.fire.chips.barista.description')
        : t('analytics.fire.chips.barista.withIncome', {
            amount: formatWholeBaseCurrency(settings.baristaMonthlyIncome),
          });
    case 'coast':
      if (chip.status === 'needs-input') return t('analytics.fire.chips.coast.needsBirthYear');
      if (chip.status === 'past-coast-age')
        return t('analytics.fire.chips.coast.pastAge', { age: settings.coastTargetAge });
      if (chip.status === 'not-meaningful') return t('analytics.fire.chips.coast.notMeaningful');
      return t('analytics.fire.chips.coast.description', { age: settings.coastTargetAge });
  }
};

const reachedText = ({ chip }: { chip: FireChip }) => {
  if (chip.key === 'coast') return t('analytics.fire.chips.reachedCoast');
  if (chip.key === 'barista' && chip.amount === 0) return t('analytics.fire.chips.reachedBaristaCovers');
  return t('analytics.fire.chips.reached');
};
</script>
