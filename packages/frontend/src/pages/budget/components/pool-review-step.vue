<script setup lang="ts">
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useFormatCurrency } from '@/composable';
import { trimAmountNoise } from '@/js/helpers/currency-decimals';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type PoolDirection,
  type PoolItem,
  type PoolSuggestion,
  amountToneClass,
  fillInOrder,
  poolCost,
  sumPoolItems,
} from '../helpers';

const props = defineProps<{
  view: BudgetPlanPeriodView;
  suggestion: PoolSuggestion;
  direction: PoolDirection;
  /** What each line needs in full, before any capping to Ready to Assign. */
  items: PoolItem[];
  pending: boolean;
}>();

const emit = defineEmits<{ back: []; submit: [items: PoolItem[]] }>();

const { t } = useI18n();
const { baseCurrencyDecimals: decimals, formatBaseCurrency } = useFormatCurrency();

const isTakeBack = props.direction === 'takeBack';
const readyToAssign = computed(() => props.view.pool?.readyToAssign ?? 0);
const linesById = computed(() => new Map(props.view.lines.map((line) => [line.lineId, line])));

const costOf = ({ item }: { item: PoolItem }) => {
  const line = linesById.value.get(item.lineId);
  return line ? poolCost({ line, amount: item.amount, decimals: decimals.value }) : item.amount;
};
const toCosts = ({ items }: { items: PoolItem[] }) =>
  items.map((item) => ({ lineId: item.lineId, amount: costOf({ item }) }));

const neededTotal = sumPoolItems({
  items: isTakeBack ? props.items : toCosts({ items: props.items }),
  decimals: decimals.value,
});
const isShort = !isTakeBack && neededTotal > readyToAssign.value;
// Fills on what each line costs Ready to Assign, then takes the uncounted baseline back off.
const prefill = isShort
  ? fillInOrder({ items: toCosts({ items: props.items }), available: readyToAssign.value, decimals: decimals.value })
      .map((filled) => ({
        lineId: filled.lineId,
        amount: trimAmountNoise({
          value: filled.amount - costOf({ item: { lineId: filled.lineId, amount: 0 } }),
          decimals: decimals.value,
        }),
      }))
      .filter((filled) => filled.amount > 0)
  : props.items;

const rows = ref(
  props.items.map((item) => {
    const filled = prefill.find((entry) => entry.lineId === item.lineId);
    return {
      lineId: item.lineId,
      need: item.amount,
      checked: Boolean(filled),
      amount: (filled?.amount ?? item.amount) as number | null,
    };
  }),
);

type Row = (typeof rows.value)[number];

const rowError = ({ row }: { row: Row }) => {
  const line = linesById.value.get(row.lineId);
  if (!isTakeBack || !row.checked || !line || (row.amount ?? 0) <= line.poolAssigned) return undefined;
  return t('budgetPlans.pool.review.tooMuch', { amount: formatBaseCurrency(line.poolAssigned) });
};

const rowDetail = ({ row }: { row: Row }) => {
  const line = linesById.value.get(row.lineId);
  const need = formatBaseCurrency(row.need);
  switch (props.suggestion) {
    case 'goals':
      return row.checked && (row.amount ?? 0) < row.need
        ? {
            text: t('budgetPlans.pool.review.goalPartial', { amount: formatBaseCurrency(row.amount ?? 0), need }),
            warning: true,
          }
        : { text: t('budgetPlans.pool.review.goalNeeds', { amount: need }), warning: false };
    case 'overspending':
      return { text: t('budgetPlans.pool.review.overBy', { amount: need }), warning: false };
    case 'repeat': {
      const lastMonth = trimAmountNoise({ value: (line?.assigned ?? 0) + row.need, decimals: decimals.value });
      return {
        text: t('budgetPlans.pool.review.lastMonth', { amount: formatBaseCurrency(lastMonth) }),
        warning: false,
      };
    }
    case 'leftovers':
      return {
        text: t('budgetPlans.pool.review.leftAvailable', { amount: formatBaseCurrency(line?.available ?? 0) }),
        warning: false,
      };
  }
};

const selected = computed(() =>
  rows.value
    .filter((row) => row.checked && (row.amount ?? 0) > 0)
    .map((row) => ({ lineId: row.lineId, amount: row.amount ?? 0 })),
);
const total = computed(() => sumPoolItems({ items: selected.value, decimals: decimals.value }));
const poolTotal = computed(() =>
  isTakeBack ? total.value : sumPoolItems({ items: toCosts({ items: selected.value }), decimals: decimals.value }),
);
const after = computed(() =>
  trimAmountNoise({
    value: readyToAssign.value + (isTakeBack ? poolTotal.value : -poolTotal.value),
    decimals: decimals.value,
  }),
);
const canSubmit = computed(() => !props.pending && total.value > 0 && rows.value.every((row) => !rowError({ row })));

const hint = {
  goals: 'budgetPlans.pool.review.goalsHint',
  overspending: 'budgetPlans.pool.review.overspendingHint',
  repeat: 'budgetPlans.pool.review.repeatHint',
  leftovers: 'budgetPlans.pool.review.leftoversHint',
} as const;
</script>

<template>
  <div class="grid gap-3">
    <p class="text-muted-foreground text-sm">{{ $t(hint[suggestion]) }}</p>

    <p v-if="isShort" class="text-warning-text text-sm">
      {{
        $t(suggestion === 'goals' ? 'budgetPlans.pool.review.goalsShort' : 'budgetPlans.pool.review.short', {
          total: formatBaseCurrency(neededTotal),
          available: formatBaseCurrency(readyToAssign),
        })
      }}
    </p>

    <ScrollArea class="max-h-64" viewport-class="max-h-64">
      <div class="grid gap-2 pr-2">
        <div v-for="row in rows" :key="row.lineId" class="grid gap-1">
          <div class="flex items-center gap-2">
            <label class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2">
              <Checkbox :model-value="row.checked" @update:model-value="(value) => (row.checked = value === true)" />
              <span class="min-w-0">
                <span class="block truncate text-sm">{{ linesById.get(row.lineId)?.name }}</span>
                <span
                  :class="
                    cn(
                      'block truncate text-xs',
                      rowDetail({ row }).warning ? 'text-warning-text' : 'text-muted-foreground',
                    )
                  "
                >
                  {{ rowDetail({ row }).text }}
                </span>
              </span>
            </label>
            <FormattedAmountField
              class="w-28 shrink-0"
              :decimals="decimals"
              size="sm"
              :model-value="row.amount"
              :disabled="!row.checked"
              :placeholder="$t('budgetPlans.assign.amountPlaceholder')"
              @update:model-value="(value) => (row.amount = value)"
            />
          </div>
          <p v-if="rowError({ row })" class="text-destructive-text text-sm">{{ rowError({ row }) }}</p>
        </div>
      </div>
    </ScrollArea>

    <dl class="bg-muted/50 grid gap-1 rounded-md p-3 text-sm">
      <div class="flex justify-between gap-3">
        <dt class="text-muted-foreground">
          {{ isTakeBack ? $t('budgetPlans.pool.review.overBySummary') : $t('budgetPlans.pool.review.readyNow') }}
        </dt>
        <dd class="tabular-nums">
          {{ formatBaseCurrency(isTakeBack ? -readyToAssign : readyToAssign) }}
        </dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="text-muted-foreground">
          {{
            isTakeBack ? $t('budgetPlans.pool.review.takenBack') : $t('budgetPlans.pool.review.goesTo', selected.length)
          }}
        </dt>
        <dd class="tabular-nums">{{ formatBaseCurrency(isTakeBack ? poolTotal : -poolTotal) }}</dd>
      </div>
      <div class="flex justify-between gap-3 font-medium">
        <dt>
          {{ isTakeBack ? $t('budgetPlans.pool.review.readyAfter') : $t('budgetPlans.pool.review.stillToAssign') }}
        </dt>
        <dd :class="cn('tabular-nums', amountToneClass({ amount: after }))">{{ formatBaseCurrency(after) }}</dd>
      </div>
    </dl>

    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" @click="emit('back')">{{ $t('common.actions.back') }}</Button>
      <Button size="sm" :disabled="!canSubmit" @click="emit('submit', selected)">
        {{
          $t(isTakeBack ? 'budgetPlans.pool.review.takeBackSubmit' : 'budgetPlans.pool.review.assignSubmit', {
            amount: formatBaseCurrency(total),
          })
        }}
      </Button>
    </div>
  </div>
</template>
