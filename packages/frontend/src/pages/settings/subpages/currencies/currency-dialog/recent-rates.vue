<template>
  <section class="grid gap-3" data-testid="recent-rates">
    <div
      v-if="savedSource === 'peg' && !isLoadingError"
      class="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3"
      data-testid="recent-rates-peg"
    >
      <div class="grid min-w-0 gap-0.5">
        <span class="text-muted-foreground text-xs">{{ $t('settings.currencies.dialog.pegRow.title') }}</span>
        <span
          v-if="!isFetched"
          class="bg-muted my-1 block h-3 w-16 animate-pulse rounded-md"
          data-testid="rate-history-loading"
          aria-hidden="true"
        />
        <template v-else-if="rates.length">
          <span class="text-sm font-semibold" data-testid="recent-rates-peg-count">
            {{ $t('settings.currencies.dialog.pegRow.count', { count: rateCount }, rateCount) }}
          </span>
          <span class="text-muted-foreground text-xs break-words">
            {{ $t('settings.currencies.dialog.pegRow.notUsed', { code, target: pegTarget }) }}
          </span>
        </template>
        <span v-else class="text-sm font-semibold" data-testid="rate-history-empty">
          {{ $t('settings.currencies.dialog.pegRow.empty') }}
        </span>
      </div>
      <Button
        v-if="rates.length"
        type="button"
        variant="outline"
        size="sm"
        data-testid="recent-rates-view-all"
        @click="emit('view-all')"
      >
        {{ $t('settings.currencies.dialog.pegRow.view') }}
      </Button>
    </div>

    <template v-else-if="savedSource !== 'peg'">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ $t('settings.currencies.dialog.recent.title') }}</h3>
        <Button
          v-if="hasMore"
          type="button"
          variant="ghost-primary"
          size="sm"
          data-testid="recent-rates-view-all"
          @click="emit('view-all')"
        >
          {{
            totalCount === null
              ? $t('settings.currencies.dialog.recent.viewAllUnknown')
              : $t('settings.currencies.dialog.recent.viewAll', { count: totalCount })
          }}
          <ChevronRightIcon class="size-4" />
        </Button>
      </div>

      <ul
        v-if="!isFetched"
        class="border-border divide-border divide-y rounded-xl border"
        data-testid="rate-history-loading"
        aria-hidden="true"
      >
        <li v-for="index in RECENT_COUNT" :key="index" class="grid gap-2 py-3 pr-2 pl-3.5">
          <span class="bg-muted block h-3 w-36 max-w-full animate-pulse rounded-md" />
          <span class="bg-muted block h-2.5 w-28 max-w-full animate-pulse rounded-md" />
        </li>
      </ul>

      <template v-else-if="!isLoadingError">
        <RateList v-if="rates.length" :currency="currency" :rates="rates.slice(0, RECENT_COUNT)" />
        <p v-else class="text-muted-foreground text-sm" data-testid="rate-history-empty">
          {{ $t('settings.currencies.dialog.pegRow.empty') }}
        </p>

        <p v-if="savedSource !== 'manual'" class="text-muted-foreground text-sm" data-testid="rate-history-note">
          {{
            $t('settings.currencies.dialog.recent.readOnly', {
              source: $t(`settings.currencies.dialog.row.source.${savedSource}`),
            })
          }}
        </p>
      </template>
    </template>

    <Callout v-if="isLoadingError" variant="destructive" data-testid="rate-history-error">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="font-semibold">{{ $t('settings.currencies.dialog.recent.loadFailedTitle') }}</p>
          <p class="text-foreground">{{ $t('settings.currencies.dialog.recent.loadFailedDetail') }}</p>
        </div>
        <Button type="button" variant="outline" size="sm" data-testid="rate-history-retry" @click="refetch()">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>
    </Callout>

    <Callout v-if="isRefetchError" variant="warning" data-testid="rate-history-refresh-error">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="min-w-0">{{ $t('settings.currencies.dialog.recent.refreshFailed') }}</p>
        <Button type="button" variant="outline" size="sm" data-testid="rate-history-refresh-retry" @click="refetch()">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>
    </Callout>
  </section>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { ChevronRightIcon } from '@lucide/vue';
import { computed } from 'vue';

import { useRateHistory } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import RateList from './rate-list.vue';
import { getPegTarget } from './source-summary';

const RECENT_COUNT = 3;

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
}>();

const emit = defineEmits<{ 'view-all': [] }>();

const code = computed(() => props.currency.currencyCode);
const savedSource = computed(() => props.currency.rateSource);
const pegTarget = computed(() => getPegTarget({ currency: props.currency }));

const { rates, totalCount, isFetched, isLoadingError, isRefetchError, hasNextPage, refetch } = useRateHistory({
  code: code.value,
});

const rateCount = computed(() => totalCount.value ?? rates.value.length);
const hasMore = computed(() => isFetched.value && (rates.value.length > RECENT_COUNT || hasNextPage.value));
</script>
