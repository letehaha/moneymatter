<template>
  <div v-if="data.length === 0" class="text-muted-foreground py-16 text-center text-sm">
    {{ $t('pages.budgetDetails.statistics.noCategoryData') }}
  </div>

  <div v-else class="flex flex-col items-center gap-6 @[630px]:flex-row @[630px]:items-start">
    <!-- Chart (left) -->
    <div class="flex shrink-0 flex-col items-center">
      <div ref="chartContainerRef" class="relative size-67.5">
        <svg ref="svgRef" class="h-full w-full"></svg>

        <!-- Center label -->
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="flex flex-col items-center gap-0.5 text-center">
            <template v-if="centerLabel.isHovering">
              <div class="text-muted-foreground max-w-24 truncate text-xs">{{ centerLabel.name }}</div>
              <div class="text-sm font-semibold">{{ centerLabel.amount }}</div>
            </template>
            <template v-else>
              <div class="text-muted-foreground text-xs">{{ $t('pages.budgetDetails.statistics.total') }}</div>
              <div class="text-sm font-semibold">{{ formatBaseCurrency(totalAmount) }}</div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Legend (right) -->
    <div class="max-w-100 min-w-0 flex-1 space-y-1 self-stretch">
      <template v-for="item in data" :key="item.categoryId">
        <!-- Root category row -->
        <div
          class="flex items-center gap-2 rounded-md px-1 py-1"
          :class="item.children?.length ? 'hover:bg-muted/50 cursor-pointer' : ''"
          @click="item.children?.length ? toggleExpand(item.categoryId) : undefined"
        >
          <ChevronRightIcon
            v-if="item.children?.length"
            class="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200"
            :class="{ 'rotate-90': expandedCategories.has(item.categoryId) }"
          />
          <div v-else class="w-3.5 shrink-0" />
          <CategoryCircle :category-id="item.categoryId" />
          <span class="truncate text-sm">{{ item.name }}</span>
          <span class="text-muted-foreground ml-auto text-sm font-medium tabular-nums">
            {{ formatBaseCurrency(item.amount) }}
          </span>
          <span class="text-muted-foreground w-10 text-right text-xs">
            {{ Math.round((item.amount / totalAmount) * 100) }}%
          </span>
        </div>

        <!-- Child category rows (expanded) -->
        <template v-if="item.children?.length && expandedCategories.has(item.categoryId)">
          <div v-for="child in item.children" :key="child.categoryId" class="flex items-center gap-2 px-1 py-1 pl-6">
            <div class="w-3.5 shrink-0" />
            <CategoryCircle :category-id="child.categoryId" />
            <span class="text-muted-foreground truncate text-xs">{{ child.name }}</span>
            <span class="text-muted-foreground ml-auto text-xs font-medium tabular-nums">
              {{ formatBaseCurrency(child.amount) }}
            </span>
            <span class="text-muted-foreground w-10 text-right text-xs">
              {{ Math.round((child.amount / totalAmount) * 100) }}%
            </span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import CategoryCircle from '@/components/common/category-circle.vue';
import { useFormatCurrency } from '@/composable';
import { ROUTES_NAMES } from '@/routes';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, type BudgetSpendingByCategoryItem } from '@bt/shared/types';
import * as d3 from 'd3';
import { ChevronRightIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { useResizeObserver } from '@vueuse/core';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps<{
  data: BudgetSpendingByCategoryItem[];
}>();

const { formatBaseCurrency } = useFormatCurrency();
const router = useRouter();
const categoriesStore = useCategoriesStore();
const { categoriesMap } = storeToRefs(categoriesStore);

const getAllCategoryIds = ({ rootCategoryId }: { rootCategoryId: string }): string[] => {
  const result = [rootCategoryId];
  const categories = Object.values(categoriesMap.value);

  const findChildren = ({ parentId }: { parentId: string }) => {
    categories.forEach((cat) => {
      if (cat.parentId === parentId && !result.includes(cat.id)) {
        result.push(cat.id);
        findChildren({ parentId: cat.id });
      }
    });
  };

  findChildren({ parentId: rootCategoryId });
  return result;
};

const navigateToTransactions = ({ categoryId }: { categoryId: string }) => {
  const allCategoryIds = getAllCategoryIds({ rootCategoryId: categoryId });

  router.push({
    name: ROUTES_NAMES.transactions,
    query: {
      categoryIds: allCategoryIds.map(String),
      transactionType: TRANSACTION_TYPES.expense,
    },
  });
};

const chartContainerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const expandedCategories = ref(new Set<string>());

const centerLabel = reactive({
  name: '',
  amount: '',
  isHovering: false,
});

const totalAmount = computed(() => props.data.reduce((sum, item) => sum + item.amount, 0));

const totalCategoryCount = computed(() => props.data.reduce((sum, item) => sum + 1 + (item.children?.length ?? 0), 0));

const getDefaultExpanded = (): Set<string> => {
  if (totalCategoryCount.value < 10) {
    return new Set(props.data.filter((item) => item.children?.length).map((item) => item.categoryId));
  }
  return new Set();
};

const toggleExpand = (categoryId: string) => {
  const next = new Set(expandedCategories.value);
  if (next.has(categoryId)) {
    next.delete(categoryId);
  } else {
    next.add(categoryId);
  }
  expandedCategories.value = next;
};

const renderChart = () => {
  if (!svgRef.value || !chartContainerRef.value || props.data.length === 0) return;

  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = chartContainerRef.value.clientWidth;
  const height = chartContainerRef.value.clientHeight;

  const glowSize = 10;
  const radius = Math.min(width, height) / 2 - glowSize;
  const innerRadius = radius * 0.7;

  const pie = d3
    .pie<BudgetSpendingByCategoryItem>()
    .value((d) => d.amount)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<BudgetSpendingByCategoryItem>>().innerRadius(innerRadius).outerRadius(radius);

  const glowArc = d3
    .arc<d3.PieArcDatum<BudgetSpendingByCategoryItem>>()
    .innerRadius(radius)
    .outerRadius(radius + glowSize);

  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);

  const glowGroup = g.append('g').attr('class', 'glow-group');
  const pieData = pie(props.data);

  const arcs = g.selectAll('.arc').data(pieData).enter().append('g').attr('class', 'arc');

  arcs
    .append('path')
    .attr('d', arc)
    .attr('fill', (d) => d.data.color)
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer')
    .style('transition', 'opacity 0.2s ease')
    .on('mouseenter', function (_event, d) {
      g.selectAll('.arc path').style('opacity', 0.3);
      d3.select(this).style('opacity', 1);

      glowGroup.selectAll('*').remove();
      glowGroup.append('path').attr('d', glowArc(d)).attr('fill', d.data.color).style('opacity', 0.5);

      centerLabel.name = d.data.name;
      centerLabel.amount = formatBaseCurrency(d.data.amount);
      centerLabel.isHovering = true;
    })
    .on('mouseleave', function () {
      g.selectAll('.arc path').style('opacity', 1);
      glowGroup.selectAll('*').remove();
      centerLabel.isHovering = false;
    })
    .on('click', function (_event, d) {
      navigateToTransactions({ categoryId: d.data.categoryId });
    });
};

useResizeObserver(chartContainerRef, renderChart);

watch(
  [() => props.data, chartContainerRef],
  async ([newData, container]) => {
    if (newData.length > 0 && container) {
      expandedCategories.value = getDefaultExpanded();
      await nextTick();
      renderChart();
    }
  },
  { immediate: true, deep: true },
);
</script>
