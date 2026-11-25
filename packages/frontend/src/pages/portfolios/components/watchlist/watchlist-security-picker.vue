<script setup lang="ts">
import { searchSecurities } from '@/api/securities';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { controlMinHeight } from '@/components/lib/ui/control-size';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import type { SecuritySearchResultFormatted } from '@bt/shared/types/investments';
import { ChevronDownIcon, SearchIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { computed, ref, watch } from 'vue';

const SEARCH_DEBOUNCE_MS = 300;

const props = defineProps<{ portfolioId: string }>();
const selected = defineModel<SecuritySearchResultFormatted | null>({ required: true });

const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const isOpen = ref(false);
const searchTerm = ref('');
const debouncedTerm = refDebounced(
  computed(() => searchTerm.value.trim()),
  SEARCH_DEBOUNCE_MS,
);

watch(isOpen, (open) => {
  if (open) searchTerm.value = '';
});

const searchQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.securitySearch, debouncedTerm.value, props.portfolioId] as const),
  queryFn: () => searchSecurities({ query: debouncedTerm.value, portfolioId: props.portfolioId }),
  enabled: () => isOpen.value && debouncedTerm.value.length >= 1,
});
const results = computed(() => searchQuery.data.value ?? []);
const isSearching = computed(
  () => !!searchTerm.value.trim() && (searchTerm.value.trim() !== debouncedTerm.value || searchQuery.isFetching.value),
);

const pick = (result: SecuritySearchResultFormatted) => {
  selected.value = result;
  isOpen.value = false;
};
</script>

<template>
  <div>
    <FieldLabel :label="$t('portfolioDetail.watchlist.add.securityLabel')" only-template>
      <template #label-after>
        <span class="text-destructive-text" aria-hidden="true">*</span>
      </template>
    </FieldLabel>

    <ResponsivePopover
      v-model:open="isOpen"
      :title="$t('portfolioDetail.watchlist.add.securityLabel')"
      align="start"
      content-class="w-(--reka-popover-trigger-width) p-0"
    >
      <template #trigger>
        <Button
          type="button"
          variant="field"
          :class="cn('group h-auto w-full justify-between gap-3 text-left', controlMinHeight.default)"
          aria-required="true"
          data-testid="watchlist-security-picker"
        >
          <span v-if="selected" class="flex min-w-0 flex-1 items-center gap-3">
            <SecurityLogo :security="selected" class="size-6" />
            <span class="min-w-0">
              <span class="block font-semibold">{{ selected.symbol }}</span>
              <span class="text-muted-foreground block truncate text-xs font-normal">
                {{
                  [selected.name, selected.exchangeName, selected.currencyCode.toUpperCase()]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </span>
            </span>
          </span>
          <span v-else class="text-muted-foreground font-normal">
            {{ $t('portfolioDetail.watchlist.add.securityPlaceholder') }}
          </span>
          <ChevronDownIcon
            class="text-muted-foreground size-4 shrink-0 transition group-data-[state=open]:rotate-180"
          />
        </Button>
      </template>

      <div :class="cn('flex flex-col', isMobile && 'flex-col-reverse gap-2')">
        <div :class="cn(!isMobile && 'border-border border-b p-2')">
          <InputField
            v-model="searchTerm"
            size="sm"
            autofocus
            :placeholder="$t('dialogs.addSymbols.searchPlaceholder')"
          >
            <template #iconLeading>
              <SearchIcon class="text-muted-foreground size-4" />
            </template>
          </InputField>
        </div>

        <div :class="cn('overflow-hidden', isMobile ? 'h-[50dvh]' : 'h-72')">
          <ScrollArea v-if="isSearching" class="h-full">
            <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-3 py-2">
              <div class="bg-muted size-5 animate-pulse rounded-full" />
              <div class="bg-muted h-4 w-14 animate-pulse rounded" />
              <div class="bg-muted h-4 w-40 animate-pulse rounded opacity-60" />
            </div>
          </ScrollArea>
          <div
            v-else-if="searchQuery.error.value"
            class="text-destructive-text flex h-full items-center justify-center p-4 text-center text-sm"
          >
            {{ $t('dialogs.addSymbols.searchError') }}
          </div>
          <div
            v-else-if="!searchTerm.trim()"
            class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm"
          >
            <SearchIcon class="size-6" />
            {{ $t('dialogs.addSymbols.emptyState.description') }}
          </div>
          <div
            v-else-if="!results.length"
            class="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm"
          >
            {{ $t('dialogs.addSymbols.noResults') }}
          </div>
          <ScrollArea v-else class="h-full">
            <ul class="p-1">
              <li v-for="result in results" :key="`${result.providerName}:${result.providerSymbol}`">
                <Button
                  type="button"
                  variant="ghost"
                  :class="
                    cn('h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal', controlMinHeight.default)
                  "
                  @click="pick(result)"
                >
                  <SecurityLogo :security="result" class="size-5" />
                  <span class="font-medium">{{ result.symbol }}</span>
                  <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">{{ result.name }}</span>
                  <span class="text-muted-foreground text-xs">{{ result.currencyCode.toUpperCase() }}</span>
                </Button>
              </li>
            </ul>
          </ScrollArea>
        </div>
      </div>
    </ResponsivePopover>
  </div>
</template>
