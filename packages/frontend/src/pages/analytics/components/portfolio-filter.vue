<template>
  <div v-if="enabledPortfolios.length > 0" class="w-[190px] max-w-full">
    <MultiSelectField
      v-model:open="isOpen"
      v-model:search-term="searchQuery"
      :active="isNarrowed"
      :label="$t('analytics.portfolioFilter.all')"
      :selected-label="selectedLabel"
      :search-placeholder="$t('analytics.portfolioFilter.searchPlaceholder')"
      :selected="includedIdList"
      content-class="w-72"
      @clear="clearSelection"
    >
      <div class="border-border/60 text-muted-foreground border-b px-3 py-2 text-xs">
        {{ $t(scopeHintKey) }}
      </div>

      <ScrollArea class="max-h-72" viewport-class="max-h-72">
        <ListboxContent class="p-2">
          <div v-if="!hasResults" class="text-muted-foreground py-4 text-center text-sm">
            {{ $t('analytics.portfolioFilter.noResults') }}
          </div>

          <MultiSelectItem
            v-for="portfolio in filteredPortfolios"
            :key="portfolio.id"
            :value="portfolio.id"
            class="data-[state=checked]:bg-primary/5 gap-2.5 px-2 py-1.5"
            @toggle="togglePortfolio(portfolio.id)"
          >
            <Checkbox :model-value="isChecked(portfolio.id)" class="pointer-events-none" tabindex="-1" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ portfolio.name }}</span>
          </MultiSelectItem>
        </ListboxContent>
      </ScrollArea>
    </MultiSelectField>
  </div>
</template>

<script setup lang="ts">
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { usePortfolios } from '@/composable/data-queries/portfolios';
import MultiSelectItem from '@/components/fields/multi-select-item.vue';
import { ListboxContent } from 'reka-ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Investment-portfolio filter shared across analytics reports. Scopes only the
 * investment slice each report derives from the selected portfolios; the exact
 * concept it narrows differs per report, so the scope-hint copy is passed in via
 * `scopeHintKey`.
 *
 * `modelValue` is the set of INCLUDED portfolio ids. An EMPTY array is the
 * load-bearing "all portfolios" default: every enabled portfolio is included and
 * the host sends no filter to the API. A non-empty array narrows the report to
 * exactly those portfolios.
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string[];
    // i18n key for the report-specific scope hint shown above the portfolio list.
    scopeHintKey: string;
  }>(),
  {
    modelValue: () => [],
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const { t } = useI18n();
const { data: portfolios } = usePortfolios();

const isOpen = ref(false);
const searchQuery = ref('');

// Only enabled portfolios are selectable — the report itself excludes disabled
// ones, so offering them here would let the user pick a filter that changes nothing.
const enabledPortfolios = computed(() => (portfolios.value ?? []).filter((portfolio) => portfolio.isEnabled));
const enabledIds = computed(() => enabledPortfolios.value.map((portfolio) => portfolio.id));

// Empty modelValue means "all", so treat it as every enabled portfolio being
// checked. A stored id that is no longer enabled is dropped rather than counted.
const includedIds = computed<Set<string>>(() => {
  const stored = props.modelValue ?? [];
  if (stored.length === 0) return new Set(enabledIds.value);
  const enabledSet = new Set(enabledIds.value);
  return new Set(stored.filter((id) => enabledSet.has(id)));
});

const includedIdList = computed(() => [...includedIds.value]);
const selectedCount = computed(() => includedIds.value.size);

// The filter narrows only when a strict subset of the enabled portfolios is
// included; "all included" and "none stored" both read as the wide-open default.
const isNarrowed = computed(() => selectedCount.value > 0 && selectedCount.value < enabledIds.value.length);

const isChecked = (portfolioId: string) => includedIds.value.has(portfolioId);

const selectedLabel = computed(() =>
  selectedCount.value === 1
    ? t('analytics.portfolioFilter.selectedOne')
    : t('analytics.portfolioFilter.selectedMany', { n: selectedCount.value }),
);

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());

const filteredPortfolios = computed(() => {
  if (!normalizedSearch.value) return enabledPortfolios.value;
  return enabledPortfolios.value.filter((portfolio) => portfolio.name.toLowerCase().includes(normalizedSearch.value));
});

const hasResults = computed(() => filteredPortfolios.value.length > 0);

const togglePortfolio = (portfolioId: string) => {
  const next = new Set(includedIds.value);
  if (next.has(portfolioId)) next.delete(portfolioId);
  else next.add(portfolioId);

  // Collapse "every enabled included" and "nothing left" back to the empty "all"
  // sentinel — there is no distinct "no portfolios" state, empty always means all.
  if (next.size === 0 || next.size === enabledIds.value.length) {
    emit('update:modelValue', []);
    return;
  }

  emit('update:modelValue', [...next]);
};

const clearSelection = () => emit('update:modelValue', []);
</script>
