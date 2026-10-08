<script setup lang="ts">
import { searchSecurities } from '@/api/securities';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import SecurityLogo from '@/components/common/security-logo.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import * as Popover from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { ASSET_CLASS, type ResolvedSecurityRef, type SecuritySearchResult } from '@bt/shared/types/investments';
import { useQuery } from '@tanstack/vue-query';
import { ChevronDownIcon, SearchIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const SEARCH_DEBOUNCE_MS = 250;

const props = defineProps<{
  modelValue: ResolvedSecurityRef | null;
  /** Securities already selected on OTHER holding rows. Disables them in the dropdown. */
  blockedProviderSymbols: string[];
  /**
   * Raw symbol the parser pulled from the source file. Surfaces in the picker
   * so users staring at "Pick security…" know what they're meant to find,
   * and pre-fills the search box when they open the popover for the first
   * time on a still-unresolved row.
   */
  parsedSymbol?: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: ResolvedSecurityRef | null): void;
}>();

const { t } = useI18n();

type AssetClassFilter = 'all' | ASSET_CLASS.stocks | ASSET_CLASS.crypto;
const assetClassFilter = ref<AssetClassFilter>('all');

const assetClassItems = computed(() => [
  { value: 'all', label: t('dialogs.addSymbols.filters.all') },
  { value: ASSET_CLASS.stocks, label: t('dialogs.addSymbols.filters.stocks') },
  { value: ASSET_CLASS.crypto, label: t('dialogs.addSymbols.filters.crypto') },
]);

const isOpen = ref(false);
const searchTerm = ref('');
const debounced = ref('');

// First time the popover opens for an unresolved row, seed the search box
// with the parsed symbol so the user doesn't have to retype it. We only do
// this once (`hasPrefilled`) — re-opening later keeps whatever the user typed.
const hasPrefilled = ref(false);
watch(isOpen, (open) => {
  if (!open) return;
  if (hasPrefilled.value) return;
  if (props.modelValue) return;
  if (!props.parsedSymbol) return;
  searchTerm.value = props.parsedSymbol;
  debounced.value = props.parsedSymbol;
  hasPrefilled.value = true;
});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchTerm, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounced.value = v.trim();
  }, SEARCH_DEBOUNCE_MS);
});

const blockedSet = computed(() => new Set(props.blockedProviderSymbols));

const apiAssetClass = computed<ASSET_CLASS | undefined>(() =>
  assetClassFilter.value === 'all' ? undefined : assetClassFilter.value,
);

const query = useQuery({
  queryKey: computed(
    () => [...VUE_QUERY_CACHE_KEYS.investmentImportSecuritySearch, debounced.value, assetClassFilter.value] as const,
  ),
  queryFn: () => searchSecurities({ query: debounced.value, assetClass: apiAssetClass.value }),
  enabled: () => debounced.value.length >= 1,
});

function pickResult(result: SecuritySearchResult) {
  emit('update:modelValue', {
    securityId: null,
    providerSymbol: result.providerSymbol,
    symbol: result.symbol,
    name: result.name,
    assetClass: result.assetClass,
    providerName: result.providerName,
    currencyCode: result.currencyCode,
    exchangeName: result.exchangeName,
    cryptoCurrencyCode: result.cryptoCurrencyCode,
    alreadyInDb: false,
  });
  isOpen.value = false;
  searchTerm.value = '';
  debounced.value = '';
}

const buttonLabel = computed(() => {
  if (!props.modelValue) return '';
  return `${props.modelValue.symbol} — ${props.modelValue.name}`;
});

const hasResults = computed(() => (query.data.value ?? []).length > 0);
</script>

<template>
  <Popover.Popover v-model:open="isOpen">
    <Popover.PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        :class="[
          'group inline-flex w-full items-center justify-between gap-2 text-left font-normal',
          modelValue ? '' : 'border-destructive-text',
        ]"
      >
        <span v-if="modelValue" class="truncate font-medium">{{ buttonLabel }}</span>
        <span v-else class="text-destructive-text">{{ $t('investmentsImport.review.pickSecurity') }}</span>
        <ChevronDownIcon class="text-muted-foreground size-4 shrink-0 transition group-data-[state=open]:rotate-180" />
      </Button>
    </Popover.PopoverTrigger>

    <Popover.PopoverContent class="w-90 p-0" align="start">
      <div class="space-y-2 border-b p-2">
        <!-- Hint with the raw symbol the parser saw, so users don't pick blind. -->
        <p v-if="parsedSymbol && !modelValue" class="text-muted-foreground px-1 text-xs">
          <i18n-t keypath="investmentsImport.review.parsedSymbolHint" tag="span">
            <template #symbol>
              <code class="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[11px]">{{ parsedSymbol }}</code>
            </template>
          </i18n-t>
        </p>

        <InputField
          v-model="searchTerm"
          type="text"
          :placeholder="$t('investmentsImport.review.searchPlaceholder')"
          autofocus
        >
          <template #iconLeading>
            <SearchIcon class="text-muted-foreground size-4" />
          </template>
        </InputField>

        <PillTabs v-model="assetClassFilter" :items="assetClassItems" size="sm" />
      </div>

      <ScrollArea class="max-h-70">
        <div v-if="query.isFetching.value" class="text-muted-foreground p-3 text-center text-xs">
          {{ $t('investmentsImport.review.searching') }}
        </div>
        <div v-else-if="!debounced" class="text-muted-foreground p-3 text-center text-xs">
          {{ $t('investmentsImport.review.startTyping') }}
        </div>
        <div v-else-if="!hasResults" class="text-muted-foreground p-3 text-center text-xs">
          {{ $t('investmentsImport.review.noResults') }}
        </div>
        <ul v-else class="py-1">
          <li v-for="r in query.data.value" :key="`${r.providerName}:${r.providerSymbol}`">
            <Button
              type="button"
              variant="ghost"
              :disabled="blockedSet.has(r.providerSymbol)"
              class="flex h-auto w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-left font-normal"
              @click="pickResult(r)"
            >
              <SecurityLogo :security="r" class="size-5" />
              <span class="min-w-0 flex-1">
                <span class="font-medium">{{ r.symbol }}</span>
                <span class="text-muted-foreground ml-2 truncate text-xs">{{ r.name }}</span>
              </span>
              <span
                v-if="r.assetClass === ASSET_CLASS.crypto && assetClassFilter === 'all'"
                class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
              >
                {{ $t('dialogs.addSymbols.assetClass.crypto') }}
              </span>
              <span v-if="blockedSet.has(r.providerSymbol)" class="text-muted-foreground text-[10px]">
                {{ $t('investmentsImport.review.alreadyPicked') }}
              </span>
            </Button>
          </li>
        </ul>
      </ScrollArea>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>
