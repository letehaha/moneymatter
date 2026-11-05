<template>
  <MultiSelectField
    v-model:search-term="searchTerm"
    :active="trackerIds.length > 0"
    :label="$t('fields.budgetMultiSelect.label')"
    :selected-label="selectedLabel"
    :search-placeholder="$t('fields.budgetMultiSelect.searchPlaceholder')"
    :hide-clear-button="hideClearButton"
    :selected="trackerIds"
    content-class="min-w-64"
    @clear="emit('update:trackerIds', [])"
  >
    <ScrollArea class="max-h-85 lg:max-h-60" viewport-class="max-h-85 lg:max-h-60">
      <ListboxContent class="p-1.25">
        <template v-if="allowBlank && !searchTerm.trim()">
          <MultiSelectItem
            :value="BLANK_FILTER_VALUE"
            class="data-highlighted:text-accent-foreground text-muted-foreground mb-1 gap-2 px-2 py-1 text-sm"
            @toggle="toggle(BLANK_FILTER_VALUE)"
          >
            <CircleDashedIcon class="size-4 shrink-0" />
            <span class="min-w-0 grow truncate">{{ $t('fields.budgetMultiSelect.blankOption') }}</span>
            <CheckIcon v-if="trackerIds.includes(BLANK_FILTER_VALUE)" class="size-4 shrink-0" />
          </MultiSelectItem>
          <div class="bg-border mb-1 h-px" />
        </template>
        <div v-if="isFetching && displayedTrackers.length === 0" class="text-muted-foreground py-3 text-center text-xs">
          {{ $t('common.loading') }}
        </div>
        <p
          v-else-if="displayedTrackers.length === 0"
          class="text-muted-foreground py-2 text-center text-xs font-medium"
        >
          {{ $t(isError ? 'fields.budgetMultiSelect.loadError' : 'fields.budgetMultiSelect.noResults') }}
        </p>
        <MultiSelectItem
          v-for="tracker in displayedTrackers"
          :key="tracker.id"
          :value="tracker.id"
          class="data-highlighted:text-accent-foreground gap-2 px-2 py-1"
          @toggle="toggle(tracker.id)"
        >
          <span class="min-w-0 grow truncate">{{ tracker.name }}</span>
          <CheckIcon v-if="trackerIds.includes(tracker.id)" class="size-4 shrink-0" />
        </MultiSelectItem>
      </ListboxContent>
    </ScrollArea>
  </MultiSelectField>
</template>

<script setup lang="ts">
import { loadTrackers } from '@/api/trackers';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { BLANK_FILTER_VALUE } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { CheckIcon, CircleDashedIcon } from '@lucide/vue';
import MultiSelectItem from '@/components/fields/multi-select-item.vue';
import { ListboxContent } from 'reka-ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  trackerIds: string[];
  hideClearButton?: boolean;
  /** Offer a pseudo-option (`BLANK_FILTER_VALUE`) matching transactions linked to no tracker. */
  allowBlank?: boolean;
}>();

const emit = defineEmits<{ 'update:trackerIds': [value: string[]] }>();

const { t } = useI18n();
const searchTerm = ref('');

const {
  data: trackers,
  isFetching,
  isError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.trackersList, 'active,archived'],
  queryFn: () => loadTrackers({ status: 'active,archived' }),
  staleTime: Infinity,
  placeholderData: [],
});

const { addErrorNotification } = useNotificationCenter();
watch(isError, (failed) => {
  if (failed) addErrorNotification(t('fields.budgetMultiSelect.loadError'));
});

const displayedTrackers = computed(() => {
  const q = searchTerm.value.trim().toLowerCase();
  return (trackers.value ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
});

const selectedLabel = computed(() => {
  if (props.trackerIds.length !== 1) return t('fields.budgetMultiSelect.selectedMany', { n: props.trackerIds.length });
  const [onlyId] = props.trackerIds;
  if (onlyId === BLANK_FILTER_VALUE) return t('fields.budgetMultiSelect.blankOption');
  return trackers.value?.find((b) => b.id === onlyId)?.name ?? t('fields.budgetMultiSelect.unknownBudget');
});

const toggle = (id: string) => {
  emit(
    'update:trackerIds',
    props.trackerIds.includes(id) ? props.trackerIds.filter((x) => x !== id) : [...props.trackerIds, id],
  );
};
</script>
