<template>
  <MultiSelectField
    v-model:open="isOpen"
    v-model:search-term="searchTerm"
    :active="!isAllSelected"
    :label="placeholder ?? $t('fields.comboboxCategories.unselectedPlaceholder')"
    :selected-label="selectedLabel"
    :search-placeholder="$t('fields.comboboxCategories.searchPlaceholder')"
    :trigger-class="triggerClass"
    :hide-clear-button="scopePicker"
    :selected="categoryIds"
    content-class="min-w-75"
    @clear="clearSelection"
  >
    <template v-if="isExcluding" #leading>
      <CircleOffIcon class="text-muted-foreground size-4 shrink-0" />
    </template>
    <template v-else-if="scopePicker && categoryIds.length === 1" #leading>
      <CategoryCircle :category-id="categoryIds[0]" />
    </template>

    <slot name="header" />

    <ScrollArea class="max-h-85 lg:max-h-60" viewport-class="max-h-85 lg:max-h-60">
      <ListboxContent class="p-1.25" :class="{ 'select-none': isShiftPressed }">
        <p v-if="displayedItems.length === 0" class="text-muted-foreground py-2 text-center text-xs font-medium">
          {{ $t('fields.categoryMultiSelect.noCategoriesFound') }}
        </p>

        <!-- ListboxItem memoizes its attrs, so rows remount when search toggles to update the indent. -->
        <template v-for="(item, index) in displayedItems" :key="`${item.id}:${isSearching}`">
          <!-- Group separator (shown only when searching and root changes) -->
          <div
            v-if="shouldShowSeparator({ item, index })"
            class="text-muted-foreground flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-medium"
            :class="{ 'pt-1': index === 0 }"
          >
            <span class="shrink-0">{{ item.rootParentName }}</span>
            <div class="bg-border h-px flex-1" />
          </div>

          <MultiSelectItem
            :value="item.id"
            class="data-highlighted:text-accent-foreground data-[state=checked]:bg-primary/5 gap-2 py-1.5 pr-2"
            :style="{ paddingLeft: `${8 + (isSearching ? 0 : item.depth) * 16}px` }"
            @toggle="scopePicker ? selectOnly({ item }) : handleToggle({ item, index })"
          >
            <span
              :class="scopePicker && '-m-1.5 flex cursor-pointer p-1.5'"
              @click="onCheckboxClick({ event: $event, item, index })"
            >
              <Checkbox :model-value="isCategoryChecked(item)" class="pointer-events-none size-3.5" tabindex="-1">
                <MinusIcon v-if="isCategoryChecked(item) === 'indeterminate'" class="size-3" />
                <CheckIcon v-else class="size-3" />
              </Checkbox>
            </span>
            <CategoryCircle :category="item" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>
            <span v-if="!isSearching && item.descendantIds.length > 0" class="text-muted-foreground text-xs">
              {{ item.descendantIds.length }}
            </span>
          </MultiSelectItem>
        </template>
      </ListboxContent>
    </ScrollArea>
  </MultiSelectField>
</template>

<script setup lang="ts">
import CategoryCircle from '@/components/common/category-circle.vue';
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import MultiSelectItem from '@/components/fields/multi-select-item.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useCategoriesStore } from '@/stores';
import { CheckIcon, CircleOffIcon, MinusIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { ListboxContent } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type FlatCategory,
  computeCheckedState,
  computeSessionRootOrder,
  flattenCategories,
  sortInternalLast,
  toggleCategorySelection,
} from './combobox-categories.helpers';

const props = defineProps<{
  categoryIds: string[];
  /** Overrides the default "All categories" trigger text shown while nothing is selected. */
  placeholder?: string;
  /** Extra classes merged onto the trigger so a host can reshape it (e.g. the
   * Pivot Report renders it as a compact rounded filter pill). */
  triggerClass?: string;
  /** When true, a category's checkbox reflects only its own membership — a selected
   * child no longer paints its ancestors as indeterminate. Selecting still cascades
   * down (clicking a parent selects its whole subtree); this only changes how partial
   * states display. Defaults to the tri-state roll-up the Records filters and Trends
   * comparison use. */
  independentCheckState?: boolean;
  /** Display only: `exclude` swaps the label and leading icon, selection behaviour is identical. */
  mode?: 'include' | 'exclude';
  /** Row click selects only that category and closes; the checkbox adds or removes just that
   * row, without its subtree, since each selected category already counts everything below it. */
  scopePicker?: boolean;
  /** Overrides the trigger text shown while a selection is active. */
  selectedText?: string;
}>();

const emit = defineEmits<{
  'update:categoryIds': [value: string[]];
}>();

const { t } = useI18n();

const { formattedCategories } = storeToRefs(useCategoriesStore());

const searchTerm = ref('');
const isOpen = ref(false);

const selectedIdsSet = computed(() => new Set(props.categoryIds));

const baseOrderedCategories = computed(() =>
  flattenCategories({ categories: sortInternalLast({ roots: formattedCategories.value }) }),
);

const sessionRootOrder = ref<string[]>([]);

watch(isOpen, (open) => {
  if (!open) {
    lastClickedIndex = null;
    return;
  }

  sessionRootOrder.value = computeSessionRootOrder({
    roots: formattedCategories.value,
    selectedIds: selectedIdsSet.value,
  });
});

const orderedFlatCategories = computed<FlatCategory[]>(() => {
  if (!isOpen.value || !sessionRootOrder.value.length) {
    return baseOrderedCategories.value;
  }

  const byRoot = new Map<string, FlatCategory[]>();
  for (const item of baseOrderedCategories.value) {
    const group = byRoot.get(item.rootParentId) ?? [];
    group.push(item);
    byRoot.set(item.rootParentId, group);
  }

  const result: FlatCategory[] = [];
  for (const rootId of sessionRootOrder.value) {
    const group = byRoot.get(rootId);
    if (group) result.push(...group);
  }
  return result;
});

const isSearching = computed(() => searchTerm.value.trim().length > 0);

const displayedItems = computed(() => {
  if (!isSearching.value) return orderedFlatCategories.value;
  const term = searchTerm.value.trim().toLowerCase();
  return orderedFlatCategories.value.filter((item) => item.name.toLowerCase().includes(term));
});

const shouldShowSeparator = ({ item, index }: { item: FlatCategory; index: number }): boolean => {
  if (!isSearching.value) return false;
  if (index === 0) return true;
  const prev = displayedItems.value[index - 1];
  return prev?.rootParentId !== item.rootParentId;
};

const isCategoryChecked = (item: FlatCategory) =>
  computeCheckedState({
    item,
    selectedIds: selectedIdsSet.value,
    isSearching: isSearching.value,
    independent: props.independentCheckState || props.scopePicker,
  });

// Shift-click range selection
const isShiftPressed = ref(false);
let lastClickedIndex: number | null = null;

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Shift') isShiftPressed.value = true;
};

const onKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'Shift') isShiftPressed.value = false;
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
});

const handleToggle = ({ item, index }: { item: FlatCategory; index: number }) => {
  const next = toggleCategorySelection({
    item,
    clickedIndex: index,
    currentSelection: props.categoryIds,
    displayedItems: displayedItems.value,
    isSearching: isSearching.value,
    isShiftPressed: isShiftPressed.value,
    lastClickedIndex,
    cascade: !props.scopePicker,
  });

  lastClickedIndex = index;
  emit('update:categoryIds', next);
};

const onCheckboxClick = ({ event, item, index }: { event: MouseEvent; item: FlatCategory; index: number }) => {
  if (!props.scopePicker) return;
  event.stopPropagation();
  handleToggle({ item, index });
};

const selectOnly = ({ item }: { item: FlatCategory }) => {
  emit('update:categoryIds', [item.id]);
  isOpen.value = false;
};

const selectedCategoryCount = computed(() => props.categoryIds.length);

const isExcluding = computed(() => props.mode === 'exclude' && selectedCategoryCount.value > 0);

const selectedLabel = computed(() => {
  if (props.selectedText) return props.selectedText;
  const n = selectedCategoryCount.value;

  if (props.mode === 'exclude') {
    return n === 1 ? t('fields.comboboxCategories.excludingOne') : t('fields.comboboxCategories.excludingMany', { n });
  }

  return n === 1 ? t('fields.comboboxCategories.selectedOne') : t('fields.comboboxCategories.selectedMany', { n });
});

const isAllSelected = computed(() => props.categoryIds.length === 0);

const clearSelection = () => {
  lastClickedIndex = null;
  emit('update:categoryIds', []);
};
</script>
