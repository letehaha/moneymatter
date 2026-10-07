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
        <div
          v-for="(node, index) in group.nodes"
          :key="index"
          class="relative grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-[13px]"
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
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { useChartColors } from '@/composable/charts/chart-colors';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type MoneyFlow,
  type MoneyFlowNode,
  OTHER_NODE_ID,
  formatShare,
  nodeColor,
  nodeLabel,
  pctOfIncome,
} from '../utils/build-money-flow';

const props = defineProps<{ flow: MoneyFlow }>();

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const colors = useChartColors();

// A flat list has no ribbons tying a per-category "other" row to its root, so the name carries it.
const listLabel = ({ node }: { node: MoneyFlowNode }) =>
  node.id === OTHER_NODE_ID && node.parentName
    ? `${node.parentName} › ${nodeLabel({ node, t })}`
    : nodeLabel({ node, t });

const groups = computed(() => {
  const { income, expenses, taxes, savings, sources, expenseNodes, taxNodes, savingsNodes } = props.flow;
  return [
    { label: t('analytics.cashFlow.income'), total: income, hint: '', nodes: sources, color: colors.value.appIncome },
    {
      label: t('analytics.cashFlow.composition.taxes'),
      total: taxes,
      hint: pctOfIncome({ value: taxes, income, t }),
      nodes: taxNodes,
      color: colors.value.primary,
    },
    {
      label: t('analytics.cashFlow.expenses'),
      total: expenses,
      hint: pctOfIncome({ value: expenses, income, t }),
      nodes: expenseNodes,
      color: colors.value.appExpense,
    },
    {
      label: t('analytics.cashFlow.composition.savings'),
      total: savings,
      hint: pctOfIncome({ value: savings, income, t }),
      nodes: savingsNodes,
      color: colors.value.appSavings,
    },
  ].filter((g) => g.nodes.length > 0);
});
</script>
