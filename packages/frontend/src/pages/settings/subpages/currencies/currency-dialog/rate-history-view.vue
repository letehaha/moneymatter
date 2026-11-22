<template>
  <section class="grid gap-3" data-testid="rate-history">
    <Callout v-if="isLoadingError" variant="destructive" data-testid="rate-history-error">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="min-w-0 font-semibold">{{ $t('settings.currencies.dialog.recent.loadFailedTitle') }}</p>
        <Button type="button" variant="outline" size="sm" data-testid="rate-history-retry" @click="refetch()">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>
    </Callout>

    <div v-else-if="!isFetched" class="grid gap-2" data-testid="rate-history-loading" aria-hidden="true">
      <div v-for="index in SKELETON_ROWS" :key="index" class="bg-muted/50 h-14 animate-pulse rounded-md" />
    </div>

    <div
      v-else-if="!rates.length"
      class="flex flex-col items-center gap-3 py-6 text-center"
      data-testid="rate-history-empty"
    >
      <div class="bg-muted flex size-12 items-center justify-center rounded-full">
        <HistoryIcon class="text-muted-foreground size-6" aria-hidden="true" />
      </div>
      <p class="text-muted-foreground max-w-prose text-sm">
        {{
          savedSource === 'peg'
            ? $t('settings.currencies.dialog.history.empty', { code, target: pegTarget })
            : $t('settings.currencies.dialog.pegRow.empty')
        }}
      </p>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-muted-foreground text-sm" data-testid="rate-history-count">
          {{ $t('settings.currencies.dialog.history.count', { count: rateCount }, rateCount) }}
        </span>
        <Button v-if="isManual" type="button" size="sm" data-testid="rate-history-update" @click="isAddOpen = true">
          {{ $t('settings.currencies.dialog.summary.update') }}
        </Button>
      </div>

      <Callout v-if="isRefetchError" variant="warning" data-testid="rate-history-refresh-error">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="min-w-0">{{ $t('settings.currencies.dialog.recent.refreshFailed') }}</p>
          <Button type="button" variant="outline" size="sm" data-testid="rate-history-refresh-retry" @click="refetch()">
            {{ $t('common.actions.retry') }}
          </Button>
        </div>
      </Callout>

      <RateList :currency="currency" :rates="rates" />

      <Callout v-if="isFetchNextPageError" variant="destructive" data-testid="rate-history-older-error">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="min-w-0 font-semibold">{{ $t('settings.currencies.dialog.recent.loadFailedTitle') }}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :loading="isFetchingNextPage"
            :disabled="isFetchingNextPage"
            data-testid="rate-history-older-retry"
            @click="fetchNextPage()"
          >
            {{ $t('common.actions.retry') }}
          </Button>
        </div>
      </Callout>

      <div v-else-if="hasNextPage" class="flex justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :loading="isFetchingNextPage"
          :disabled="isFetchingNextPage"
          data-testid="rate-history-show-more"
          @click="fetchNextPage()"
        >
          {{ $t('settings.currencies.dialog.history.showOlder') }}
        </Button>
      </div>

      <p v-if="!isManual" class="text-muted-foreground text-sm" data-testid="rate-history-note">
        {{
          savedSource === 'peg'
            ? $t('settings.currencies.dialog.pegRow.notUsed', { code, target: pegTarget })
            : $t('settings.currencies.dialog.recent.readOnly', {
                source: $t(`settings.currencies.dialog.row.source.${savedSource}`),
              })
        }}
      </p>
    </template>

    <RateFormDialog v-model:open="isAddOpen" :currency="currency" />
  </section>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { HistoryIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { useRateHistory } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import RateFormDialog from './rate-form-dialog.vue';
import RateList from './rate-list.vue';
import { getPegTarget } from './source-summary';

const SKELETON_ROWS = 3;

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
}>();

const code = computed(() => props.currency.currencyCode);
const savedSource = computed(() => props.currency.rateSource);
const pegTarget = computed(() => getPegTarget({ currency: props.currency }));
const isManual = computed(() => savedSource.value === 'manual');

const {
  rates,
  totalCount,
  isFetched,
  isLoadingError,
  isRefetchError,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
  refetch,
} = useRateHistory({ code: code.value });

const rateCount = computed(() => totalCount.value ?? rates.value.length);

const isAddOpen = ref(false);
</script>
