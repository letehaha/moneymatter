<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { trimAmountNoise } from '@/js/helpers/currency-decimals';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodView, BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { ArrowRightIcon, ArrowUpDownIcon } from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSetAssignments } from '../composables/use-set-assignments';
import {
  amountToneClass,
  defaultMove,
  goalAskOf,
  moveAssignmentsPayload,
  moveRoom,
  overspentBy,
  poolCost,
  undoAssignmentsPayload,
} from '../helpers';

const props = defineProps<{
  planId: string;
  view: BudgetPlanPeriodView;
  /** Live lines in grid order. */
  lines: BudgetPlanPeriodViewLine[];
  line: BudgetPlanPeriodViewLine | null;
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const [DefineLineOption, LineOption] = createReusableTemplate<{
  item: { label: string; available: number; hint?: string };
}>();

const { t } = useI18n();
const { baseCurrencyDecimals: decimals, formatBaseCurrency } = useFormatCurrency();

const fromId = ref<string | null>(null);
const toId = ref<string | null>(null);
const amount = ref<number | null>(null);

watch(isOpen, (open) => {
  if (!open) return;
  const next = props.line
    ? defaultMove({ lines: props.lines, line: props.line })
    : { fromId: null, toId: null, amount: null };
  fromId.value = next.fromId;
  toId.value = next.toId;
  amount.value = next.amount;
});

const lineById = ({ id }: { id: string | null }) => props.lines.find((entry) => entry.lineId === id);
const from = computed(() => lineById({ id: fromId.value }));
const to = computed(() => lineById({ id: toId.value }));

const needHint = ({ line }: { line: BudgetPlanPeriodViewLine }) => {
  const ask = goalAskOf({ line });
  if (ask !== null) return t('budgetPlans.pool.line.goalHint', { amount: formatBaseCurrency(ask) });
  const over = overspentBy({ line });
  return over === null ? undefined : t('budgetPlans.pool.line.overspentHint', { amount: formatBaseCurrency(over) });
};
const optionsWithout = ({ id, withHints = false }: { id: string | null; withHints?: boolean }) =>
  props.lines
    .filter((entry) => entry.lineId !== id)
    .map((entry) => ({
      value: entry.lineId,
      label: entry.name,
      available: entry.available,
      hint: withHints ? needHint({ line: entry }) : undefined,
    }));
const fromOptions = computed(() => optionsWithout({ id: toId.value }));
const toOptions = computed(() =>
  optionsWithout({ id: fromId.value, withHints: true }).sort((a, b) => Number(!!b.hint) - Number(!!a.hint)),
);

const swap = () => {
  [fromId.value, toId.value] = [toId.value, fromId.value];
};

const room = computed(() => (from.value ? moveRoom({ line: from.value }) : 0));
const error = computed(() =>
  from.value && (amount.value ?? 0) > room.value
    ? t('budgetPlans.move.tooMuch', { line: from.value.name, amount: formatBaseCurrency(room.value) })
    : undefined,
);
const total = computed(() => Math.min(amount.value ?? 0, room.value));

const preview = computed(() => {
  if (!from.value || !to.value) return [];
  const after = ({ line, delta }: { line: BudgetPlanPeriodViewLine; delta: number }) => ({
    label: t('budgetPlans.pool.line.previewAvailable', { line: line.name }),
    before: line.available,
    after: trimAmountNoise({ value: line.available + delta, decimals: decimals.value }),
  });
  const rows = [after({ line: from.value, delta: -total.value }), after({ line: to.value, delta: total.value })];
  // A move nets to zero, except in a future period where an override also brings a line's baseline into the pool.
  const readyToAssign = props.view.pool?.readyToAssign;
  const poolDelta = trimAmountNoise({
    value:
      poolCost({ line: from.value, amount: -total.value, decimals: decimals.value }) +
      poolCost({ line: to.value, amount: total.value, decimals: decimals.value }),
    decimals: decimals.value,
  });
  if (readyToAssign === undefined || !poolDelta) return rows;
  return [
    ...rows,
    {
      label: t('budgetPlans.pool.readyToAssign'),
      before: readyToAssign,
      after: trimAmountNoise({ value: readyToAssign - poolDelta, decimals: decimals.value }),
    },
  ];
});

const chips = computed(() => {
  const over = to.value ? overspentBy({ line: to.value }) : null;
  return [
    ...(over === null
      ? []
      : [{ value: over, label: t('budgetPlans.move.chipCover', { amount: formatBaseCurrency(over) }) }]),
    ...(room.value > 0 && room.value !== over
      ? [{ value: room.value, label: t('budgetPlans.move.chipAll', { amount: formatBaseCurrency(room.value) }) }]
      : []),
  ];
});

const { isPending, mutate } = useSetAssignments({
  onSuccess: () => {
    isOpen.value = false;
  },
});

const submit = () => {
  if (!from.value || !to.value || isPending.value) return;
  const payload = moveAssignmentsPayload({
    view: props.view,
    fromId: from.value.lineId,
    toId: to.value.lineId,
    amount: total.value,
    decimals: decimals.value,
  });
  if (!payload) return;
  mutate({
    planId: props.planId,
    periodId: props.view.period.id,
    payload,
    text: t('budgetPlans.move.toast', {
      amount: formatBaseCurrency(total.value),
      from: from.value.name,
      to: to.value.name,
    }),
    undoPayload: undoAssignmentsPayload({ view: props.view, lineIds: [from.value.lineId, to.value.lineId] }),
  });
};
</script>

<template>
  <DefineLineOption v-slot="{ item }">
    <span class="flex w-full items-center justify-between gap-3">
      <span class="min-w-0">
        <span class="block truncate">{{ item.label }}</span>
        <span v-if="item.hint" class="text-muted-foreground block truncate text-xs">{{ item.hint }}</span>
      </span>
      <span :class="cn('shrink-0 text-sm tabular-nums', amountToneClass({ amount: item.available }))">
        {{ formatBaseCurrency(item.available) }}
      </span>
    </span>
  </DefineLineOption>

  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="max-w-md">
    <template #title>{{ $t('budgetPlans.move.title') }}</template>
    <template #description>{{ $t('budgetPlans.move.description') }}</template>

    <form class="grid gap-3" @submit.prevent="submit">
      <SelectField
        :model-value="fromOptions.find((option) => option.value === fromId) ?? null"
        :values="fromOptions"
        :label="$t('budgetPlans.move.fromLabel')"
        :placeholder="$t('budgetPlans.move.pickPlaceholder')"
        with-search
        @update:model-value="(option) => (fromId = option?.value ?? null)"
      >
        <template #item="{ item }"><LineOption :item="item" /></template>
      </SelectField>

      <div class="flex items-center gap-2">
        <span class="bg-border h-px flex-1" />
        <DesktopOnlyTooltip :content="$t('budgetPlans.move.swap')">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            class="rounded-full"
            :aria-label="$t('budgetPlans.move.swap')"
            @click="swap"
          >
            <ArrowUpDownIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
        <span class="bg-border h-px flex-1" />
      </div>

      <SelectField
        :model-value="toOptions.find((option) => option.value === toId) ?? null"
        :values="toOptions"
        :label="$t('budgetPlans.move.toLabel')"
        :placeholder="$t('budgetPlans.move.pickPlaceholder')"
        with-search
        @update:model-value="(option) => (toId = option?.value ?? null)"
      >
        <template #item="{ item }"><LineOption :item="item" /></template>
      </SelectField>

      <FormattedAmountField
        :decimals="decimals"
        :model-value="amount"
        :label="$t('budgetPlans.move.amountLabel')"
        :placeholder="$t('budgetPlans.assign.amountPlaceholder')"
        :error-message="error"
        @update:model-value="(next) => (amount = next)"
      />

      <div v-if="chips.length" class="flex flex-wrap gap-2">
        <Button
          v-for="chip in chips"
          :key="chip.label"
          type="button"
          variant="outline"
          size="xs"
          :class="cn(amount === chip.value && 'bg-accent hover:bg-accent')"
          @click="amount = chip.value"
        >
          {{ chip.label }}
        </Button>
      </div>

      <dl v-if="preview.length" class="bg-muted/50 grid gap-1 rounded-md p-3 text-sm">
        <div v-for="row in preview" :key="row.label" class="flex justify-between gap-3">
          <dt class="text-muted-foreground min-w-0 truncate">{{ row.label }}</dt>
          <dd class="flex shrink-0 items-center gap-1 tabular-nums">
            {{ formatBaseCurrency(row.before) }}
            <ArrowRightIcon class="text-muted-foreground size-3.5" />
            <span :class="amountToneClass({ amount: row.after })">{{ formatBaseCurrency(row.after) }}</span>
          </dd>
        </div>
      </dl>

      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
        <Button type="submit" :disabled="!from || !to || total <= 0 || isPending">
          {{
            $t(error ? 'budgetPlans.move.submitInstead' : 'budgetPlans.move.submit', {
              amount: formatBaseCurrency(total),
            })
          }}
        </Button>
      </div>
    </form>
  </ResponsiveDialog>
</template>
