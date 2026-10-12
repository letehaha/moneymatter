<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import {
  CalculatorIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  ChevronDownIcon,
  EllipsisIcon,
  GaugeIcon,
  PlusIcon,
} from '@lucide/vue';

import { GRID_ROW_CLASS, amountToneClass, availablePillClass } from '../helpers';
import BudgetLineBars from './budget-line-bars.vue';
import BudgetLineSpentText from './budget-line-spent-text.vue';

defineEmits<{ start: [] }>();

const { formatBaseCurrency } = useFormatCurrency();

const STEPS = ['accounts', 'suggested', 'available'] as const;

const PANEL_SECTIONS = [
  { titleKey: 'budgetPlans.panel.breakdown', icon: CalculatorIcon },
  { titleKey: 'budgetPlans.panel.scheduled', icon: CalendarClockIcon },
  { titleKey: 'budgetPlans.panel.trend.title', icon: ChartColumnIcon },
  { titleKey: 'budgetPlans.panel.pace', icon: GaugeIcon },
] as const;

const withTotals = ({ lines }: { lines: { key: string; assigned: number; spent: number }[] }) => {
  const rows = lines.map((line) => ({
    ...line,
    carriedIn: 0,
    activity: -line.spent,
    available: line.assigned - line.spent,
  }));
  return {
    rows,
    assigned: rows.reduce((sum, line) => sum + line.assigned, 0),
    spent: rows.reduce((sum, line) => sum + line.spent, 0),
    available: rows.reduce((sum, line) => sum + line.available, 0),
  };
};

const EXAMPLE_GROUPS = [
  {
    key: 'bills',
    ...withTotals({
      lines: [
        { key: 'rent', assigned: 1400, spent: 1400 },
        { key: 'utilities', assigned: 220, spent: 184.5 },
        { key: 'subscriptions', assigned: 120, spent: 96.3 },
      ],
    }),
  },
  {
    key: 'everyday',
    ...withTotals({
      lines: [
        { key: 'groceries', assigned: 650, spent: 403 },
        { key: 'eatingOut', assigned: 200, spent: 242.1 },
        { key: 'transport', assigned: 180, spent: 63 },
      ],
    }),
  },
  {
    key: 'life',
    ...withTotals({
      lines: [
        { key: 'funMoney', assigned: 300, spent: 58 },
        { key: 'savings', assigned: 400, spent: 200 },
      ],
    }),
  },
];

const totals = EXAMPLE_GROUPS.reduce(
  (acc, group) => ({
    assigned: acc.assigned + group.assigned,
    spent: acc.spent + group.spent,
    available: acc.available + group.available,
    overspent: acc.overspent + group.rows.reduce((sum, line) => sum + Math.min(line.available, 0), 0),
  }),
  { assigned: 0, spent: 0, available: 0, overspent: 0 },
);
const exampleLines = EXAMPLE_GROUPS.flatMap((group) => group.rows);
const overspentLineCount = exampleLines.filter((line) => line.available < 0).length;
const TONED_TOTALS = new Set(['available', 'overspent']);

const CHECKBOX_CLASS = 'border-muted-foreground/50 size-[18px] rounded-[4px] border';
</script>

<template>
  <div class="@container/budget-empty">
    <div class="relative">
      <div
        aria-hidden="true"
        class="border-border bg-card pointer-events-none hidden min-h-[640px] grid-cols-[minmax(0,1fr)_330px] overflow-clip rounded-lg border [mask-image:linear-gradient(to_bottom,black_30%,transparent_95%)] opacity-60 select-none @3xl/budget-empty:grid"
      >
        <div class="min-w-0">
          <dl class="border-border divide-border flex divide-x border-b px-4 py-2">
            <div v-for="(amount, key) in totals" :key="key" class="flex-1 px-4 first:pl-0">
              <dt class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {{ $t(`budgetPlans.tiles.${key}`) }}
                <template v-if="key === 'overspent'">
                  · {{ $t('budgetPlans.tiles.overspentLines', { count: overspentLineCount }) }}</template
                >
              </dt>
              <dd :class="cn('text-lg font-bold tabular-nums', TONED_TOTALS.has(key) && amountToneClass({ amount }))">
                {{ formatBaseCurrency(amount) }}
              </dd>
            </div>
          </dl>

          <div
            :class="cn(GRID_ROW_CLASS, 'text-muted-foreground py-2 text-[11px] font-medium tracking-wide uppercase')"
          >
            <span :class="CHECKBOX_CLASS" />
            <span class="flex items-center gap-2">
              <ChevronDownIcon class="size-4" />
              {{ $t('budgetPlans.groups.headerLabel') }}
              <PlusIcon class="size-3.5" />
            </span>
            <span class="text-right">{{ $t('budgetPlans.grid.assigned') }}</span>
            <span class="text-right">{{ $t('budgetPlans.grid.activity') }}</span>
            <span class="text-right">{{ $t('budgetPlans.grid.available') }}</span>
            <span />
          </div>

          <template v-for="group in EXAMPLE_GROUPS" :key="group.key">
            <div :class="cn(GRID_ROW_CLASS, 'border-border bg-muted border-t py-1.5 text-sm font-medium')">
              <span :class="CHECKBOX_CLASS" />
              <span class="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                <ChevronDownIcon class="size-4" />
                {{ $t(`budgetPlans.empty.example.groups.${group.key}`) }}
                <PlusIcon class="size-3.5" />
              </span>
              <span class="text-right tabular-nums">{{ formatBaseCurrency(group.assigned) }}</span>
              <span class="text-muted-foreground text-right tabular-nums">{{ formatBaseCurrency(-group.spent) }}</span>
              <span :class="cn('text-right tabular-nums', amountToneClass({ amount: group.available }))">
                {{ formatBaseCurrency(group.available) }}
              </span>
              <EllipsisIcon class="text-muted-foreground mx-auto size-4" />
            </div>

            <div v-for="line in group.rows" :key="line.key" :class="cn(GRID_ROW_CLASS, 'border-border border-t py-2')">
              <span :class="CHECKBOX_CLASS" />
              <span class="min-w-0">
                <span class="block truncate text-sm leading-5 font-semibold">
                  {{ $t(`budgetPlans.empty.example.lines.${line.key}`) }}
                </span>
                <span class="text-muted-foreground flex justify-end text-xs leading-4">
                  <BudgetLineSpentText :line="line" />
                </span>
                <BudgetLineBars :line="line" mode="spending" />
              </span>
              <span
                class="border-input bg-input-background h-9 rounded-md border px-2.5 text-right text-sm leading-8 tabular-nums"
              >
                {{ formatBaseCurrency(line.assigned) }}
              </span>
              <span class="text-muted-foreground text-right text-sm tabular-nums">
                {{ formatBaseCurrency(-line.spent) }}
              </span>
              <span class="text-right">
                <span :class="availablePillClass({ amount: line.available })">{{
                  formatBaseCurrency(line.available)
                }}</span>
              </span>
              <EllipsisIcon class="text-muted-foreground mx-auto size-4" />
            </div>
          </template>

          <div :class="cn(GRID_ROW_CLASS, 'border-border border-t py-2.5 text-sm font-medium')">
            <span />
            <span class="text-muted-foreground">{{
              $t('budgetPlans.grid.totalWithLines', { count: exampleLines.length })
            }}</span>
            <span class="text-right tabular-nums">{{ formatBaseCurrency(totals.assigned) }}</span>
            <span class="text-muted-foreground text-right tabular-nums">{{ formatBaseCurrency(-totals.spent) }}</span>
            <span :class="cn('text-right tabular-nums', amountToneClass({ amount: totals.available }))">
              {{ formatBaseCurrency(totals.available) }}
            </span>
            <span />
          </div>
        </div>

        <aside class="border-border grid content-start gap-4 border-l p-4">
          <div>
            <p class="font-semibold">{{ $t('budgetPlans.panel.overview') }}</p>
            <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.empty.exampleBadge') }}</p>
          </div>
          <div class="divide-border divide-y">
            <div
              v-for="section in PANEL_SECTIONS"
              :key="section.titleKey"
              class="flex min-h-11 items-center gap-3 py-2"
            >
              <span class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
                <component :is="section.icon" class="size-4" />
              </span>
              <span class="text-sm font-medium">{{ $t(section.titleKey) }}</span>
              <ChevronDownIcon class="ml-auto size-4" />
            </div>
          </div>
        </aside>
      </div>

      <div
        class="@3xl/budget-empty:absolute @3xl/budget-empty:inset-0 @3xl/budget-empty:flex @3xl/budget-empty:items-center @3xl/budget-empty:justify-center @3xl/budget-empty:p-6"
      >
        <Card class="mx-auto grid w-full max-w-xl gap-5 p-6 @3xl/budget-empty:shadow-2xl">
          <div class="grid gap-1">
            <h2 class="text-xl font-semibold tracking-tight">{{ $t('budgetPlans.empty.title') }}</h2>
            <p class="text-muted-foreground text-sm">{{ $t('budgetPlans.empty.description') }}</p>
          </div>
          <ol class="border-border divide-border grid divide-y border-y">
            <li v-for="(step, index) in STEPS" :key="step" class="flex items-start gap-3 py-3">
              <span
                class="bg-primary/10 text-primary-text flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              >
                {{ index + 1 }}
              </span>
              <span class="grid gap-0.5">
                <span class="font-medium">{{ $t(`budgetPlans.empty.steps.${step}.title`) }}</span>
                <span class="text-muted-foreground text-sm">{{
                  $t(`budgetPlans.empty.steps.${step}.description`)
                }}</span>
              </span>
            </li>
          </ol>
          <div class="flex flex-wrap items-center gap-4">
            <Button @click="$emit('start')">{{ $t('budgetPlans.empty.action') }}</Button>
            <DocsLink path="/budgeting/start-budgeting/" class="text-sm">{{
              $t('budgetPlans.docs.howItWorks')
            }}</DocsLink>
          </div>
        </Card>
      </div>
    </div>
  </div>
</template>
