<template>
  <MultiSelectField
    v-model:search-term="searchTerm"
    :active="budgetIds.length > 0"
    :label="$t('fields.budgetMultiSelect.label')"
    :selected-label="selectedLabel"
    :search-placeholder="$t('fields.budgetMultiSelect.searchPlaceholder')"
    :hide-clear-button="hideClearButton"
    content-class="min-w-64"
    @clear="emit('update:budgetIds', [])"
  >
    <ScrollArea class="max-h-85 lg:max-h-60" viewport-class="max-h-85 lg:max-h-60">
      <div class="p-1.25">
        <template v-if="allowBlank && !searchTerm.trim()">
          <Button
            type="button"
            variant="ghost"
            class="text-muted-foreground mb-1 h-auto w-full justify-start px-2 py-1 font-normal"
            @click="toggle(BLANK_FILTER_VALUE)"
          >
            <CircleDashedIcon class="size-4 shrink-0" />
            <span class="min-w-0 grow truncate text-left">{{ $t('fields.budgetMultiSelect.blankOption') }}</span>
            <CheckIcon v-if="budgetIds.includes(BLANK_FILTER_VALUE)" class="size-4 shrink-0" />
          </Button>
          <div class="bg-border mb-1 h-px" />
        </template>
        <div v-if="isFetching && displayedBudgets.length === 0" class="text-muted-foreground py-3 text-center text-xs">
          {{ $t('common.loading') }}
        </div>
        <p v-else-if="displayedBudgets.length === 0" class="text-muted-foreground py-2 text-center text-xs font-medium">
          {{ $t(isError ? 'fields.budgetMultiSelect.loadError' : 'fields.budgetMultiSelect.noResults') }}
        </p>
        <button
          v-for="budget in displayedBudgets"
          :key="budget.id"
          type="button"
          class="hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left"
          @click="toggle(budget.id)"
        >
          <span class="min-w-0 grow truncate">{{ budget.name }}</span>
          <CheckIcon v-if="budgetIds.includes(budget.id)" class="size-4 shrink-0" />
        </button>
      </div>
    </ScrollArea>
  </MultiSelectField>
</template>

<script setup lang="ts">
import { loadSystemBudgets } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { BLANK_FILTER_VALUE } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { CheckIcon, CircleDashedIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  budgetIds: string[];
  hideClearButton?: boolean;
  /** Offer a pseudo-option (`BLANK_FILTER_VALUE`) matching transactions linked to no tracker. */
  allowBlank?: boolean;
}>();

const emit = defineEmits<{ 'update:budgetIds': [value: string[]] }>();

const { t } = useI18n();
const searchTerm = ref('');

const {
  data: budgets,
  isFetching,
  isError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetsList, 'active,archived'],
  queryFn: () => loadSystemBudgets({ status: 'active,archived' }),
  staleTime: Infinity,
  placeholderData: [],
});

const { addErrorNotification } = useNotificationCenter();
watch(isError, (failed) => {
  if (failed) addErrorNotification(t('fields.budgetMultiSelect.loadError'));
});

const displayedBudgets = computed(() => {
  const q = searchTerm.value.trim().toLowerCase();
  return (budgets.value ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
});

const selectedLabel = computed(() => {
  if (props.budgetIds.length !== 1) return t('fields.budgetMultiSelect.selectedMany', { n: props.budgetIds.length });
  const [onlyId] = props.budgetIds;
  if (onlyId === BLANK_FILTER_VALUE) return t('fields.budgetMultiSelect.blankOption');
  return budgets.value?.find((b) => b.id === onlyId)?.name ?? t('fields.budgetMultiSelect.unknownBudget');
});

const toggle = (id: string) => {
  emit(
    'update:budgetIds',
    props.budgetIds.includes(id) ? props.budgetIds.filter((x) => x !== id) : [...props.budgetIds, id],
  );
};
</script>
