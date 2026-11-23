<script setup lang="ts">
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable';
import { trimAmountNoise } from '@/js/helpers/currency-decimals';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import { ArrowRightIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type PoolDirection,
  type PoolItem,
  amountToneClass,
  goalAskOf,
  linesInGridOrder,
  overspentBy,
  pickTakeBackLine,
  poolCost,
  takeBackCandidates,
  takeBackRoom,
} from '../helpers';

const props = defineProps<{ view: BudgetPlanPeriodView; direction: PoolDirection; pending: boolean }>();

const emit = defineEmits<{ back: []; submit: [items: PoolItem[]] }>();

const { t } = useI18n();
const { baseCurrencyDecimals: decimals, formatBaseCurrency } = useFormatCurrency();

const isTakeBack = props.direction === 'takeBack';
const readyToAssign = computed(() => props.view.pool?.readyToAssign ?? 0);

const candidates = computed(() => {
  const ordered = linesInGridOrder({ view: props.view });
  if (isTakeBack) return takeBackCandidates({ lines: ordered });
  const needy = ordered.filter((line) => goalAskOf({ line }) !== null || overspentBy({ line }) !== null);
  return [...needy, ...ordered.filter((line) => !needy.includes(line))];
});

const options = computed(() =>
  candidates.value.map((line) => {
    const ask = goalAskOf({ line });
    const over = overspentBy({ line });
    let hint: string | undefined;
    if (!isTakeBack && ask !== null) hint = t('budgetPlans.pool.line.goalHint', { amount: formatBaseCurrency(ask) });
    else if (!isTakeBack && over !== null)
      hint = t('budgetPlans.pool.line.overspentHint', { amount: formatBaseCurrency(over) });
    return { value: line.lineId, label: line.name, available: line.available, hint };
  }),
);

const lineId = ref<string | null>(null);
const amount = ref<number | null>(null);
const line = computed(() => candidates.value.find((entry) => entry.lineId === lineId.value));

const pick = ({ id }: { id: string | null }) => {
  lineId.value = id;
  const picked = line.value;
  if (!picked) {
    amount.value = null;
    return;
  }
  amount.value = isTakeBack
    ? Math.min(Math.max(-readyToAssign.value, 0), takeBackRoom({ line: picked })) || null
    : (goalAskOf({ line: picked }) ?? overspentBy({ line: picked }));
};

if (isTakeBack) pick({ id: pickTakeBackLine({ lines: candidates.value })?.lineId ?? null });

const value = computed(() => amount.value ?? 0);
const sign = isTakeBack ? -1 : 1;
const availableAfter = computed(() =>
  trimAmountNoise({ value: (line.value?.available ?? 0) + sign * value.value, decimals: decimals.value }),
);
const lineAsk = computed(() => (isTakeBack || !line.value ? null : goalAskOf({ line: line.value })));
const costOf = ({ total }: { total: number }) =>
  line.value && !isTakeBack ? poolCost({ line: line.value, amount: total, decimals: decimals.value }) : total;
// The most this line can take without pushing Ready to Assign below zero.
const affordable = computed(() =>
  trimAmountNoise({ value: readyToAssign.value - costOf({ total: 0 }), decimals: decimals.value }),
);
const readyAfter = computed(() =>
  trimAmountNoise({ value: readyToAssign.value - sign * costOf({ total: value.value }), decimals: decimals.value }),
);
const overBy = computed(() =>
  isTakeBack
    ? 0
    : trimAmountNoise({ value: costOf({ total: value.value }) - readyToAssign.value, decimals: decimals.value }),
);
const error = computed(() =>
  isTakeBack && line.value && value.value > line.value.poolAssigned
    ? t('budgetPlans.pool.line.tooMuch', {
        line: line.value.name,
        amount: formatBaseCurrency(line.value.poolAssigned),
      })
    : undefined,
);
const canSubmit = computed(() => !props.pending && Boolean(line.value) && value.value > 0 && !error.value);

const chips = computed(() => {
  if (isTakeBack || !line.value) return [];
  const ask = lineAsk.value;
  return [
    ...(ask === null
      ? []
      : [{ value: ask, label: t('budgetPlans.pool.line.chipGoal', { amount: formatBaseCurrency(ask) }) }]),
    ...(affordable.value > 0
      ? [
          {
            value: affordable.value,
            label: t('budgetPlans.pool.line.chipAll', { amount: formatBaseCurrency(affordable.value) }),
          },
        ]
      : []),
  ];
});

const submit = ({ total }: { total: number }) => {
  if (line.value && total > 0) emit('submit', [{ lineId: line.value.lineId, amount: total }]);
};
</script>

<template>
  <div class="grid gap-3">
    <!-- Stays mounted after a pick: unmounting it drops focus to <body>, which closes the popover. -->
    <SelectField
      :model-value="options.find((option) => option.value === lineId) ?? null"
      :values="options"
      :label="$t('budgetPlans.pool.line.pickLabel')"
      :placeholder="$t('budgetPlans.pool.line.pickPlaceholder')"
      with-search
      @update:model-value="(option) => pick({ id: option?.value ?? null })"
    >
      <template #item="{ item }">
        <span class="flex w-full items-center justify-between gap-3">
          <span class="min-w-0">
            <span class="block truncate">{{ item.label }}</span>
            <span v-if="item.hint" class="text-muted-foreground block truncate text-xs">{{ item.hint }}</span>
          </span>
          <span :class="cn('shrink-0 text-sm tabular-nums', amountToneClass({ amount: item.available }))">
            {{ formatBaseCurrency(item.available) }}
          </span>
        </span>
      </template>
    </SelectField>

    <template v-if="line">
      <p class="text-muted-foreground -mt-1 text-xs">
        {{
          lineAsk !== null
            ? $t('budgetPlans.pool.line.availableNowGoal', {
                available: formatBaseCurrency(line.available),
                need: formatBaseCurrency(lineAsk),
              })
            : $t('budgetPlans.pool.line.availableNow', { available: formatBaseCurrency(line.available) })
        }}
      </p>

      <FormattedAmountField
        :decimals="decimals"
        :model-value="amount"
        :label="$t('budgetPlans.pool.line.amountLabel')"
        :placeholder="$t('budgetPlans.assign.amountPlaceholder')"
        :error-message="error"
        @update:model-value="(next) => (amount = next)"
      />

      <div v-if="chips.length" class="flex flex-wrap gap-2">
        <Button
          v-for="chip in chips"
          :key="chip.label"
          variant="outline"
          size="xs"
          :class="cn(amount === chip.value && 'bg-accent hover:bg-accent')"
          @click="amount = chip.value"
        >
          {{ chip.label }}
        </Button>
      </div>

      <dl class="bg-muted/50 grid gap-1 rounded-md p-3 text-sm">
        <div class="flex justify-between gap-3">
          <dt class="text-muted-foreground min-w-0 truncate">
            {{ $t('budgetPlans.pool.line.previewAvailable', { line: line.name }) }}
          </dt>
          <dd class="flex shrink-0 items-center gap-1 tabular-nums">
            {{ formatBaseCurrency(line.available) }}
            <ArrowRightIcon class="text-muted-foreground size-3.5" />
            <span :class="amountToneClass({ amount: availableAfter })">{{ formatBaseCurrency(availableAfter) }}</span>
          </dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-muted-foreground">{{ $t('budgetPlans.pool.readyToAssign') }}</dt>
          <dd class="flex shrink-0 items-center gap-1 tabular-nums">
            {{ formatBaseCurrency(readyToAssign) }}
            <ArrowRightIcon class="text-muted-foreground size-3.5" />
            <span :class="amountToneClass({ amount: readyAfter })">{{ formatBaseCurrency(readyAfter) }}</span>
          </dd>
        </div>
      </dl>

      <p v-if="overBy > 0" class="text-warning-text flex gap-2 text-sm">
        <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
        {{ $t('budgetPlans.pool.line.overWarning', { amount: formatBaseCurrency(overBy) }) }}
      </p>
    </template>

    <div class="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" size="sm" @click="emit('back')">{{ $t('common.actions.back') }}</Button>
      <template v-if="line && overBy > 0">
        <Button variant="outline" size="sm" :disabled="!canSubmit" @click="submit({ total: value })">
          {{ $t('budgetPlans.pool.line.assignAnyway', { amount: formatBaseCurrency(value) }) }}
        </Button>
        <Button v-if="affordable > 0" size="sm" :disabled="pending" @click="submit({ total: affordable })">
          {{ $t('budgetPlans.pool.line.assignInstead', { amount: formatBaseCurrency(affordable) }) }}
        </Button>
      </template>
      <Button v-else-if="line" size="sm" :disabled="!canSubmit" @click="submit({ total: value })">
        {{
          $t(isTakeBack ? 'budgetPlans.pool.review.takeBackSubmit' : 'budgetPlans.pool.review.assignSubmit', {
            amount: formatBaseCurrency(value),
          })
        }}
      </Button>
    </div>
  </div>
</template>
