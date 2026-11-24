<template>
  <div class="space-y-5">
    <div v-for="group in groups" :key="group.label" class="space-y-2">
      <p class="text-muted-foreground text-[11px] font-bold tracking-widest uppercase">
        {{ group.label }}
        <span class="text-foreground ml-1 text-xs font-extrabold tracking-normal normal-case">{{
          formatBaseCurrency(group.total)
        }}</span>
        <span v-if="group.hint" class="ml-1 font-medium tracking-normal normal-case">· {{ group.hint }}</span>
      </p>
      <div class="space-y-0.5">
        <component
          :is="link ? RouterLink : 'div'"
          v-for="({ node, link }, index) in group.rows"
          :key="index"
          :to="link ?? undefined"
          :class="
            cn(
              'relative grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-[13px]',
              link && 'hover:bg-hover focus-visible:bg-hover outline-hidden',
            )
          "
        >
          <span
            class="absolute inset-y-0 left-0 opacity-10"
            :style="{ width: `${node.share * 100}%`, background: nodeColor({ node, colors, fallback: group.color }) }"
          />
          <span
            class="relative size-2 rounded-xs"
            :style="{ background: nodeColor({ node, colors, fallback: group.color }) }"
          />
          <span class="relative truncate font-semibold">{{ listLabel({ node }) }}</span>
          <span class="relative font-semibold tabular-nums">{{ formatBaseCurrency(node.value) }}</span>
          <span class="text-muted-foreground relative min-w-8 text-right tabular-nums">{{
            formatShare(node.share)
          }}</span>
        </component>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { useChartColors } from '@/composable/charts/chart-colors';
import type { Period } from '@/composable/use-period-navigation';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import {
  type MoneyFlow,
  type MoneyFlowNode,
  OTHER_NODE_ID,
  formatShare,
  nodeColor,
  nodeLabel,
  pctOfIncome,
} from '../utils/build-money-flow';
import { type MoneyFlowNodeKind, buildNodeTransactionsLink } from '../utils/node-transactions-link';

const props = defineProps<{
  flow: MoneyFlow;
  period: Period;
  sourceLevel: number;
  expenseLevel: number;
  taxCategoryIds?: string[];
  savingsCategoryIds?: string[];
}>();

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const colors = useChartColors();
const { categories } = storeToRefs(useCategoriesStore());

// A flat list has no ribbons tying a per-category "other" row to its root, so the name carries it.
const listLabel = ({ node }: { node: MoneyFlowNode }) =>
  node.id === OTHER_NODE_ID && node.parentName
    ? `${node.parentName} › ${nodeLabel({ node, t })}`
    : nodeLabel({ node, t });

const groups = computed(() => {
  const { income, expenses, taxes, savings, sources, expenseNodes, taxNodes, savingsNodes } = props.flow;
  const toRows = ({ nodes, kind, level }: { nodes: MoneyFlowNode[]; kind: MoneyFlowNodeKind; level?: number }) =>
    nodes.map((node) => ({
      node,
      link: buildNodeTransactionsLink({
        nodeId: node.id,
        kind,
        level,
        categories: categories.value,
        period: props.period,
        taxCategoryIds: props.taxCategoryIds,
        savingsCategoryIds: props.savingsCategoryIds,
      }),
    }));
  return [
    {
      label: t('analytics.cashFlow.income'),
      total: income,
      hint: '',
      rows: toRows({ nodes: sources, kind: 'income', level: props.sourceLevel }),
      color: colors.value.appIncome,
    },
    {
      label: t('analytics.cashFlow.composition.taxes'),
      total: taxes,
      hint: pctOfIncome({ value: taxes, income, t }),
      rows: toRows({ nodes: taxNodes, kind: 'tax' }),
      color: colors.value.primary,
    },
    {
      label: t('analytics.cashFlow.expenses'),
      total: expenses,
      hint: pctOfIncome({ value: expenses, income, t }),
      rows: toRows({ nodes: expenseNodes, kind: 'expense', level: props.expenseLevel }),
      color: colors.value.appExpense,
    },
    {
      label: t('analytics.cashFlow.composition.savings'),
      total: savings,
      hint: pctOfIncome({ value: savings, income, t }),
      rows: toRows({ nodes: savingsNodes, kind: 'savings' }),
      color: colors.value.appSavings,
    },
  ].filter((g) => g.rows.length > 0);
});
</script>
