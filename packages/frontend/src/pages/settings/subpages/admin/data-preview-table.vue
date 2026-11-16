<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import { useFormatCurrency } from '@/composable';
import { format } from 'date-fns';
import { computed, ref, toRef } from 'vue';

import { type ExistingPrice, type PreviewRow, usePriceComparison } from './composables/use-price-comparison';

const props = defineProps<{
  data: PreviewRow[];
  existingPrices?: ExistingPrice[];
}>();

const { formatAmountByCurrencyCode } = useFormatCurrency();

const pageSize = 50;
const currentPage = ref(1);
const showOnlyDifferences = ref(false);

// Use price comparison composable
const { filteredData, significantDifferencesCount, hasSignificantDifferences } = usePriceComparison({
  data: toRef(props, 'data'),
  existingPrices: toRef(props, 'existingPrices'),
  showOnlyDifferences,
});

console.log('existingPrices', props.existingPrices);

const paginatedData = computed(() => {
  return filteredData.value.slice(0, currentPage.value * pageSize);
});

const hasMore = computed(() => {
  return paginatedData.value.length < filteredData.value.length;
});

const currency = computed(() => {
  return props.data[0]?.currency || '';
});

const dateRange = computed(() => {
  if (props.data.length === 0) return null;

  const dates = props.data.map((row) => new Date(row.date));
  const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const newest = new Date(Math.max(...dates.map((d) => d.getTime())));

  return {
    oldest: format(oldest, 'dd-MM-yyyy'),
    newest: format(newest, 'dd-MM-yyyy'),
  };
});

function loadMore() {
  if (hasMore.value) {
    currentPage.value++;
  }
}

function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  const scrollPercentage = (target.scrollTop + target.clientHeight) / target.scrollHeight;

  if (scrollPercentage > 0.9 && hasMore.value) {
    loadMore();
  }
}

function formatDate(dateStr: string): string {
  return format(new Date(dateStr), 'dd-MM-yyyy');
}

function formatPercentage(percent: number): string {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}
</script>

<template>
  <div class="space-y-2">
    <h3 class="text-sm font-medium">{{ $t('settings.admin.priceUpload.preview.title') }}</h3>
    <p class="text-muted-foreground text-xs">
      {{ $t('settings.admin.priceUpload.preview.recordsCount', { count: data.length }) }}
      <template v-if="dateRange">
        {{
          $t('settings.admin.priceUpload.preview.recordsPeriod', { oldest: dateRange.oldest, newest: dateRange.newest })
        }}
      </template>
    </p>

    <!-- Warning banner for significant differences -->
    <Callout
      v-if="hasSignificantDifferences"
      :title="$t('settings.admin.priceUpload.preview.warnings.significantDifferences')"
    >
      <div class="text-muted-foreground mt-1">
        {{
          $t('settings.admin.priceUpload.preview.warnings.differencesDetails', {
            count: significantDifferencesCount,
          })
        }}
      </div>
    </Callout>

    <!-- Filter checkbox -->
    <label v-if="hasSignificantDifferences" class="flex items-center gap-2 text-xs">
      <input v-model="showOnlyDifferences" type="checkbox" />
      <span>{{ $t('settings.admin.priceUpload.preview.filterCheckbox') }}</span>
    </label>

    <div class="border-border max-h-100 overflow-y-auto rounded border" @scroll="handleScroll">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 sticky top-0">
          <tr>
            <th class="border-border border-b px-3 py-2 text-left font-medium">
              {{ $t('settings.admin.priceUpload.preview.tableHeaders.date') }}
            </th>
            <th class="border-border border-b px-3 py-2 text-right font-medium">
              {{ $t('settings.admin.priceUpload.preview.tableHeaders.newPrice') }}
              <span v-if="currency">({{ currency.toUpperCase() }})</span>
            </th>
            <th v-if="existingPrices" class="border-border border-b px-3 py-2 text-right font-medium">
              {{ $t('settings.admin.priceUpload.preview.tableHeaders.existingPrice') }}
              <span v-if="currency">({{ currency.toUpperCase() }})</span>
            </th>
            <th v-if="existingPrices" class="border-border border-b px-3 py-2 text-right font-medium">
              {{ $t('settings.admin.priceUpload.preview.tableHeaders.difference') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in paginatedData"
            :key="index"
            class="hover:bg-hover transition-colors"
            :class="{ 'bg-warning/10': row.hasSignificantDiff }"
          >
            <td class="border-border border-b px-3 py-2">{{ formatDate(row.date) }}</td>
            <td class="border-border border-b px-3 py-2 text-right font-medium">
              {{ formatAmountByCurrencyCode(row.price, row.currency) }}
            </td>
            <td v-if="existingPrices" class="border-border border-b px-3 py-2 text-right">
              <template v-if="row.existingPrice !== null">
                {{ formatAmountByCurrencyCode(row.existingPrice, row.currency) }}
              </template>
              <template v-else>
                <span class="text-muted-foreground">{{
                  $t('settings.admin.priceUpload.preview.noExistingPrice')
                }}</span>
              </template>
            </td>
            <td v-if="existingPrices" class="border-border border-b px-3 py-2 text-right">
              <template v-if="row.percentageDiff !== null">
                <span
                  :class="{
                    'text-success-text': row.percentageDiff > 0,
                    'text-destructive-text': row.percentageDiff < 0,
                    'font-medium': row.hasSignificantDiff,
                  }"
                >
                  {{ formatPercentage(row.percentageDiff) }}
                </span>
              </template>
              <template v-else>
                <span class="text-muted-foreground">-</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="hasMore" class="text-muted-foreground p-3 text-center text-xs">
        {{ $t('settings.admin.priceUpload.preview.scrollForMore') }}
      </div>
    </div>

    <p v-if="showOnlyDifferences && filteredData.length === 0" class="text-muted-foreground text-center text-xs">
      {{ $t('settings.admin.priceUpload.preview.noDifferences') }}
    </p>
  </div>
</template>
