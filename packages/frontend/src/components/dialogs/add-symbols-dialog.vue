<script setup lang="ts">
import { searchSecurities } from '@/api/securities';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useCreateHolding } from '@/composable/data-queries/holdings';
import { isApiErrorWithCode } from '@/js/errors';
import { cn } from '@/lib/utils';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { API_ERROR_CODES } from '@bt/shared/types';
import { ASSET_CLASS, type SecuritySearchResult } from '@bt/shared/types/investments';
import { useQuery } from '@tanstack/vue-query';
import { AlertTriangleIcon, CheckCheckIcon, SearchIcon, SearchXIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{ portfolioId: string }>();
const emit = defineEmits<{
  (e: 'updated', payload: { securityId: string }): void;
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const searchTerm = ref('');

// Pill-tab filter: 'all' fans out to all supported providers; specific classes
// narrow the search server-side and skip the irrelevant provider call.
type AssetClassFilter = 'all' | ASSET_CLASS.stocks | ASSET_CLASS.crypto;
const assetClassFilter = ref<AssetClassFilter>('all');

const assetClassItems = computed(() => [
  { value: 'all', label: t('dialogs.addSymbols.filters.all') },
  { value: ASSET_CLASS.stocks, label: t('dialogs.addSymbols.filters.stocks') },
  { value: ASSET_CLASS.crypto, label: t('dialogs.addSymbols.filters.crypto') },
]);

const debounced = ref('');
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchTerm, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounced.value = v.trim();
  }, 300);
});

const apiAssetClass = computed<ASSET_CLASS | undefined>(() =>
  assetClassFilter.value === 'all' ? undefined : assetClassFilter.value,
);

const key = computed(() => ['sec-search', debounced.value, props.portfolioId, assetClassFilter.value] as const);

const query = useQuery({
  queryKey: key,
  queryFn: () =>
    searchSecurities({ query: debounced.value, portfolioId: props.portfolioId, assetClass: apiAssetClass.value }),
  enabled: () => debounced.value.length >= 1,
});

// View-state derivation. Keeping all branches under one container with a fixed
// min/max height stops the dialog from jumping when transitioning between
// loading/empty/results.
const trimmedTerm = computed(() => searchTerm.value.trim());
const hasQuery = computed(() => trimmedTerm.value.length > 0);
// "Pending" covers two windows where we should show skeletons rather than a
// stale or empty list:
//   1. The 300ms debounce gap between the user's keystroke and `debounced`
//      catching up — the input changed but the query hasn't fired yet.
//   2. The actual fetch is in flight.
const isSearchPending = computed(
  () => hasQuery.value && (trimmedTerm.value !== debounced.value || query.isFetching.value),
);
const results = computed(() => query.data.value ?? []);
const hasResults = computed(() => results.value.length > 0);
const showEndIndicator = computed(() => hasResults.value && results.value.length <= 3);

// self-hosting operator might miss setting the crypto-api key, so we handle it
const isCryptoProviderNotConfiguredError = computed(() =>
  isApiErrorWithCode(query.error.value, API_ERROR_CODES.cryptoProviderNotConfigured),
);

function clearSearch() {
  searchTerm.value = '';
  debounced.value = '';
}

const createHolding = useCreateHolding();
const { addNotification } = useNotificationCenter();

async function addSymbol(sec: SecuritySearchResult) {
  try {
    const newHolding = await createHolding.mutateAsync({
      portfolioId: props.portfolioId,
      searchResult: sec,
      quantity: 0,
      costBasis: 0,
    });
    addNotification({ text: t('dialogs.addSymbols.notifications.success'), type: NotificationType.success });
    isOpen.value = false;
    searchTerm.value = '';
    emit('updated', { securityId: newHolding.securityId });
  } catch {
    addNotification({ text: t('dialogs.addSymbols.notifications.error'), type: NotificationType.error });
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #trigger>
      <slot />
    </template>

    <template #title>
      <span class="inline-flex items-center gap-2">
        {{ $t('dialogs.addSymbols.title') }}

        <ResponsiveTooltip content-class-name="max-w-72" :delay-duration="100">
          <AlertTriangleIcon class="text-warning size-4 cursor-help" />
          <template #content>
            <i18n-t keypath="dialogs.createPortfolio.assetSupportNotice" tag="p">
              <template #roadmapLink>
                <a
                  :href="EXTERNAL_URLS.featurebaseRoadmap"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium underline underline-offset-2 hover:no-underline"
                >
                  {{ $t('dialogs.createPortfolio.assetSupportRoadmapLink') }}
                </a>
              </template>
              <template #feedbackLink>
                <a
                  :href="EXTERNAL_URLS.featurebaseBoard"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium underline underline-offset-2 hover:no-underline"
                >
                  {{ $t('dialogs.createPortfolio.assetSupportFeedbackLink') }}
                </a>
              </template>
            </i18n-t>
          </template>
        </ResponsiveTooltip>
      </span>
    </template>

    <template #default>
      <div class="grid gap-4">
        <InputField
          v-model="searchTerm"
          :label="$t('dialogs.addSymbols.searchLabel')"
          :placeholder="$t('dialogs.addSymbols.searchPlaceholder')"
          class="max-w-[calc(100%-50px)]"
        />

        <PillTabs v-model="assetClassFilter" :items="assetClassItems" size="sm" />

        <!-- Fixed-height container so the dialog body never grows or shrinks
             between loading, empty, results, and no-results states. -->
        <div class="h-70 overflow-hidden">
          <!-- ERROR -->
          <div
            v-if="query.error.value && !isSearchPending"
            class="flex h-full flex-col items-center justify-center gap-3 text-center"
          >
            <SearchXIcon class="text-destructive-text size-8" />
            <p class="text-destructive-text text-sm">
              {{
                isCryptoProviderNotConfiguredError
                  ? $t('dialogs.addSymbols.cryptoProviderNotConfigured')
                  : $t('dialogs.addSymbols.searchError')
              }}
            </p>
            <Button v-if="hasQuery" size="sm" variant="outline" @click="clearSearch">
              {{ $t('dialogs.addSymbols.clearSearch') }}
            </Button>
          </div>

          <!-- LOADING (debounce gap or in-flight fetch) -->
          <ScrollArea v-else-if="isSearchPending" class="h-full">
            <div
              v-for="i in 6"
              :key="`skeleton-${i}`"
              class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 px-2 py-2"
            >
              <div class="bg-muted h-4 w-14 animate-pulse rounded" />
              <div class="bg-muted h-4 w-40 animate-pulse rounded opacity-60" />
              <div class="bg-muted h-3.5 w-16 animate-pulse rounded opacity-60" />
              <div class="bg-muted h-3.5 w-10 animate-pulse rounded opacity-60" />
            </div>
          </ScrollArea>

          <!-- EMPTY (no query yet) -->
          <div v-else-if="!hasQuery" class="flex h-full flex-col items-center justify-center gap-2 text-center">
            <SearchIcon class="text-muted-foreground size-8" />
            <p class="text-sm font-medium">{{ $t('dialogs.addSymbols.emptyState.title') }}</p>
            <p class="text-muted-foreground max-w-70 text-xs">
              {{ $t('dialogs.addSymbols.emptyState.description') }}
            </p>
          </div>

          <!-- NO RESULTS -->
          <div v-else-if="!hasResults" class="flex h-full flex-col items-center justify-center gap-3 text-center">
            <SearchXIcon class="text-muted-foreground size-8" />
            <p class="text-sm font-medium">{{ $t('dialogs.addSymbols.noResults') }}</p>
            <p class="text-muted-foreground max-w-70 text-xs">
              {{ $t('dialogs.addSymbols.noResultsHint') }}
            </p>
            <Button size="sm" variant="outline" @click="clearSearch">
              {{ $t('dialogs.addSymbols.clearSearch') }}
            </Button>
          </div>

          <!-- RESULTS -->
          <ScrollArea v-else class="h-full">
            <ul>
              <li
                v-for="sec in results"
                :key="`${sec.providerName}:${sec.providerSymbol}`"
                :class="
                  cn(
                    'grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 px-2 py-1',
                    sec.isInPortfolio ? 'cursor-not-allowed opacity-80' : 'hover:bg-hover cursor-pointer',
                  )
                "
                @click="!sec.isInPortfolio && addSymbol(sec)"
              >
                <span class="flex items-center gap-2 font-medium">
                  <span v-if="sec.isInPortfolio" class="text-muted-foreground text-xs">
                    <CheckCheckIcon class="text-success-text size-3" />
                  </span>

                  <SecurityLogo :security="sec" class="size-5" />

                  {{ sec.symbol }}

                  <!-- Only show the crypto badge in mixed-class listings (the
                       "All" tab). When the user has already filtered to
                       Crypto, repeating it on every row is just noise. -->
                  <span
                    v-if="sec.assetClass === ASSET_CLASS.crypto && assetClassFilter === 'all'"
                    class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                  >
                    {{ $t('dialogs.addSymbols.assetClass.crypto') }}
                  </span>
                </span>

                <span class="text-muted-foreground truncate text-xs">
                  {{ sec.name }}

                  <span v-if="sec.isInPortfolio"> {{ $t('dialogs.addSymbols.addedIndicator') }} </span>
                </span>

                <span class="text-muted-foreground text-right text-xs">
                  <template v-if="sec.assetClass === ASSET_CLASS.crypto && sec.marketCapRank">
                    {{ $t('dialogs.addSymbols.marketCapRank', { rank: sec.marketCapRank }) }}
                  </template>
                  <template v-else>
                    {{ sec.exchangeName }}
                  </template>
                </span>

                <span class="text-muted-foreground text-right text-xs">{{ sec.currencyCode.toUpperCase() }}</span>
              </li>
            </ul>

            <!-- End-of-list indicator. Only meaningful when the list is short
                 enough that the user might wonder if more is hidden. For long
                 lists the scroll already implies "more below". -->
            <p
              v-if="showEndIndicator"
              class="text-muted-foreground border-border/30 mt-2 border-t px-2 pt-2 text-center text-xs"
            >
              {{ $t('dialogs.addSymbols.endOfList') }}
            </p>
          </ScrollArea>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
