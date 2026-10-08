<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { useFormatCurrency } from '@/composable/formatters';
import type { SelectedTotals } from '@/composable/transaction-selection';
import { ChevronDownIcon, ListIcon, SquareCheckBigIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface Figure {
  key: string;
  label: string;
  value: number;
  colorClass: string;
}

const props = defineProps<{
  totals: SelectedTotals;
  selectedCount: number;
  /** The figures cover the whole filtered set, with nothing selected. */
  matching?: boolean;
}>();

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const countLabel = computed(() =>
  t(props.matching ? 'transactions.bulkEdit.matchingCount' : 'transactions.bulkEdit.selectedCount', {
    count: props.selectedCount,
  }),
);

const net = computed<Figure>(() => ({
  key: 'net',
  label: t('transactions.bulkEdit.totals.net'),
  value: props.totals.net,
  colorClass:
    props.totals.net > 0 ? 'text-app-income-color' : props.totals.net < 0 ? 'text-app-expense-color' : 'text-inherit',
}));

const income = computed<Figure>(() => ({
  key: 'income',
  label: t('transactions.bulkEdit.totals.income'),
  value: props.totals.income,
  colorClass: 'text-app-income-color',
}));

const expense = computed<Figure>(() => ({
  key: 'expense',
  label: t('transactions.bulkEdit.totals.expense'),
  value: -props.totals.expense,
  colorClass: 'text-app-expense-color',
}));

const transfers = computed<Figure | null>(() =>
  props.totals.transfers === 0
    ? null
    : {
        key: 'transfers',
        label: t('transactions.bulkEdit.totals.transfers'),
        value: props.totals.transfers,
        colorClass: 'text-app-transfer-color',
      },
);

const breakdown = computed<Figure[]>(() => [
  income.value,
  expense.value,
  ...(transfers.value ? [transfers.value] : []),
]);

const inlineFigures = computed<Figure[]>(() => [
  income.value,
  expense.value,
  net.value,
  ...(transfers.value ? [transfers.value] : []),
]);
</script>

<template>
  <!--
    Breakpoints run on the toolbar's own width, not the viewport: the sidebar leaves the
    content area ~300px narrower, so a `sm:` breakpoint switches while the figures still clip.
    Below @4xl the summary collapses into one chip that carries the count.
  -->
  <div class="hidden items-center gap-x-4 @4xl/bulk-toolbar:flex">
    <span class="text-muted-foreground text-sm whitespace-nowrap">{{ countLabel }}</span>
    <span v-for="figure in inlineFigures" :key="figure.key" class="flex items-baseline gap-1.5 whitespace-nowrap">
      <span class="text-muted-foreground text-sm">{{ figure.label }}</span>
      <span :class="figure.colorClass" class="text-sm tabular-nums">{{ formatBaseCurrency(figure.value) }}</span>
    </span>
  </div>

  <Popover>
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm" class="gap-2 @4xl/bulk-toolbar:hidden">
        <span class="text-muted-foreground flex items-center gap-1">
          <component :is="matching ? ListIcon : SquareCheckBigIcon" class="size-3.5" />
          <span class="text-sm tabular-nums">{{ selectedCount }}</span>
        </span>
        <span :class="net.colorClass" class="text-sm tabular-nums">{{ formatBaseCurrency(net.value) }}</span>
        <ChevronDownIcon class="text-muted-foreground size-3.5" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="start" class="w-auto min-w-56 p-3">
      <div class="flex flex-col">
        <span class="text-muted-foreground border-border mb-1 border-b pb-2 text-xs">
          {{ countLabel }}
        </span>

        <span
          v-for="figure in breakdown"
          :key="figure.key"
          class="flex items-baseline justify-between gap-6 py-1 text-sm"
        >
          <span class="text-muted-foreground">{{ figure.label }}</span>
          <span :class="figure.colorClass" class="tabular-nums">{{ formatBaseCurrency(figure.value) }}</span>
        </span>

        <span class="border-border mt-1 flex items-baseline justify-between gap-6 border-t pt-2 text-sm">
          <span class="text-muted-foreground">{{ net.label }}</span>
          <span :class="net.colorClass" class="tabular-nums">{{ formatBaseCurrency(net.value) }}</span>
        </span>
      </div>
    </PopoverContent>
  </Popover>
</template>
