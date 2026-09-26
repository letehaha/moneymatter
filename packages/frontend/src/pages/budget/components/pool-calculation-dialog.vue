<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import type { BudgetPlanPool } from '@bt/shared/types';
import { ChevronDownIcon } from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { amountToneClass } from '../helpers';

const props = defineProps<{
  pool: BudgetPlanPool;
  periodLabel: string;
  previousPeriodLabel?: string;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

type Operator = '+' | '−';
type Row = {
  key: string;
  label: string;
  hint?: string;
  op?: Operator;
  term: number;
  show?: boolean;
};

const [DefineTable, ReuseTable] = createReusableTemplate<{ rows: Row[] }>();

const visible = ({ rows }: { rows: Row[] }) => rows.filter((row) => row.show !== false);

const flip = ({ op }: { op: Operator }): Operator => (op === '+' ? '−' : '+');

// A negative term flips the operator so the amount always reads as a magnitude.
const operatorOf = ({ row }: { row: Row }) => (row.op && row.term < 0 ? flip({ op: row.op }) : row.op);
const amountOf = ({ row }: { row: Row }) => (row.op ? Math.abs(row.term) : row.term);

const balanceRows = computed(() =>
  visible({
    rows: [
      {
        key: 'cash',
        label: t('budgetPlans.pool.calc.cash'),
        hint: t('budgetPlans.pool.calc.cashHint'),
        term: props.pool.balance.cash,
      },
      {
        key: 'inLines',
        label: t('budgetPlans.pool.calc.inLines'),
        hint: t('budgetPlans.pool.calc.inLinesHint'),
        op: '−',
        term: props.pool.balance.inLines,
      },
      {
        key: 'committedLater',
        label: t('budgetPlans.pool.calc.committedLater'),
        hint: t('budgetPlans.pool.calc.committedLaterHint'),
        op: '−',
        term: props.pool.committedLater,
        show: props.pool.committedLater !== 0,
      },
      {
        key: 'drift',
        label: t('budgetPlans.pool.calc.drift'),
        hint: t('budgetPlans.pool.calc.driftHint'),
        op: '−',
        term: props.pool.balance.drift,
        show: props.pool.balance.drift !== 0,
      },
    ],
  }),
);

const flowRows = computed(() =>
  visible({
    rows: [
      {
        key: 'leftOver',
        label: props.previousPeriodLabel
          ? t('budgetPlans.pool.calc.leftOverFrom', {
              period: props.previousPeriodLabel,
            })
          : t('budgetPlans.pool.calc.startingBalance'),
        term: props.pool.flow.leftOver,
      },
      {
        key: 'income',
        label: t('budgetPlans.pool.calc.income'),
        op: '+',
        term: props.pool.flow.income,
      },
      {
        key: 'outsideSpending',
        label: t('budgetPlans.pool.calc.outsideSpending'),
        op: '+',
        term: props.pool.flow.outsideSpending,
        show: props.pool.flow.outsideSpending !== 0,
      },
      {
        key: 'fromLines',
        label: t('budgetPlans.pool.calc.fromLines'),
        op: '+',
        term: props.pool.flow.fromLines,
        show: props.pool.flow.fromLines !== 0,
      },
      {
        key: 'assigned',
        label: t('budgetPlans.pool.calc.assigned'),
        op: '−',
        term: props.pool.flow.assigned,
      },
      {
        key: 'committedLater',
        label: t('budgetPlans.pool.calc.committedLater'),
        hint: t('budgetPlans.pool.calc.committedLaterHint'),
        op: '−',
        term: props.pool.committedLater,
        show: props.pool.committedLater !== 0,
      },
    ],
  }),
);

const changedTitle = computed(() =>
  props.previousPeriodLabel
    ? t('budgetPlans.pool.calc.changedSince', {
        period: props.previousPeriodLabel,
      })
    : t('budgetPlans.pool.calc.changedThisPeriod'),
);
</script>

<template>
  <DefineTable v-slot="{ rows }">
    <div class="border-border grid gap-2 rounded-lg border p-3 text-sm">
      <div v-for="row in rows" :key="row.key" class="flex items-start gap-2">
        <span class="text-muted-foreground w-3 shrink-0 text-center">{{ operatorOf({ row }) }}</span>
        <div class="min-w-0 flex-1">
          <p>{{ row.label }}</p>
          <p v-if="row.hint" class="text-muted-foreground text-xs">
            {{ row.hint }}
          </p>
        </div>
        <span class="tabular-nums">{{ formatBaseCurrency(amountOf({ row })) }}</span>
      </div>
      <div class="border-border flex items-start gap-2 border-t pt-2 font-semibold">
        <span class="text-muted-foreground w-3 shrink-0 text-center font-normal">=</span>
        <span class="min-w-0 flex-1">{{ $t('budgetPlans.pool.readyToAssign') }}</span>
        <span :class="cn('tabular-nums', amountToneClass({ amount: pool.readyToAssign }))">
          {{ formatBaseCurrency(pool.readyToAssign) }}
        </span>
      </div>
    </div>
  </DefineTable>

  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('budgetPlans.pool.calc.title') }}</template>
    <template #description>{{ periodLabel }}</template>

    <div class="grid gap-4">
      <ReuseTable :rows="balanceRows" />

      <Collapsible v-slot="{ open }">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="sm" class="w-full justify-between">
            {{ changedTitle }}
            <ChevronDownIcon :class="cn('size-4 transition-transform', open && 'rotate-180')" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent class="mt-2">
          <ReuseTable :rows="flowRows" />
        </CollapsibleContent>
      </Collapsible>

      <DocsLink path="/budgeting/ready-to-assign/" class="justify-self-start text-xs" />
    </div>
  </ResponsiveDialog>
</template>
