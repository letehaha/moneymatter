<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <p class="text-muted-foreground text-xs font-medium">{{ $t('analytics.trends.filters.payees') }}</p>
        <PillTabs
          size="sm"
          :items="modeItems"
          :model-value="filters.payees.mode"
          @update:model-value="(value) => patchGroup({ key: 'payees', changes: { mode: toMode(value) } })"
        />
      </div>
      <PayeeMultiSelectField
        :payee-ids="filters.payees.ids"
        @update:payee-ids="(value) => patchGroup({ key: 'payees', changes: { ids: value } })"
      />
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <p class="text-muted-foreground text-xs font-medium">{{ $t('analytics.trends.filters.tags') }}</p>
        <PillTabs
          size="sm"
          :items="modeItems"
          :model-value="filters.tags.mode"
          @update:model-value="(value) => patchGroup({ key: 'tags', changes: { mode: toMode(value) } })"
        />
      </div>
      <TagFilter
        :tag-ids="filters.tags.ids"
        @update:tag-ids="(value) => patchGroup({ key: 'tags', changes: { ids: value } })"
      />
    </div>

    <div class="space-y-2">
      <p class="text-muted-foreground text-xs font-medium">{{ $t('analytics.trends.filters.accounts') }}</p>
      <AccountMultiSelectField
        include-archived
        :model-value="filters.accountIds"
        @update:model-value="(value) => emit('update:filters', { ...filters, accountIds: value })"
      />
    </div>

    <div class="border-border flex justify-end border-t pt-3">
      <Button
        variant="ghost"
        size="sm"
        :disabled="activeCount === 0"
        @click="emit('update:filters', { ...emptyTrendsFilters(), categories: filters.categories })"
      >
        <RotateCcwIcon class="size-3.5" />
        {{ $t('analytics.trends.filters.reset') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import PayeeMultiSelectField from '@/components/fields/payee-multi-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import TagFilter from '@/components/records-filters/filters/tag-filter.vue';
import { RotateCcwIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type FilterGroup,
  type TrendsFilterGroupKey,
  type TrendsFilters,
  countActiveFilters,
  emptyTrendsFilters,
} from '../trends-filters';

const props = defineProps<{
  filters: TrendsFilters;
}>();

const emit = defineEmits<{
  'update:filters': [value: TrendsFilters];
}>();

const { t } = useI18n();

const modeItems = computed<PillTabItem[]>(() => [
  { value: 'include', label: t('analytics.trends.filters.include') },
  { value: 'exclude', label: t('analytics.trends.filters.exclude') },
]);

const activeCount = computed(() => countActiveFilters({ filters: props.filters }));

const toMode = (value: string) => value as FilterGroup['mode'];

const patchGroup = ({ key, changes }: { key: TrendsFilterGroupKey; changes: Partial<FilterGroup> }) =>
  emit('update:filters', { ...props.filters, [key]: { ...props.filters[key], ...changes } });
</script>
