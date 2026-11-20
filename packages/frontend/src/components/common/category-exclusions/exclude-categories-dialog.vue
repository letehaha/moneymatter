<template>
  <ResponsiveDialog v-model:open="isOpen" no-internal-scroll dialog-content-class="sm:max-w-md">
    <template #title>{{ $t('dialogs.categoryExclusions.title') }}</template>
    <template #description>{{ $t('dialogs.categoryExclusions.description') }}</template>

    <div class="flex flex-col gap-3">
      <!-- Current exclusions, each removable in one click -->
      <div v-if="excludedCategories.length" class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-warning-text text-xs font-medium">
            {{ $t('dialogs.categoryExclusions.countExcluded', excludedCategories.length) }}
          </span>
          <Button variant="ghost" size="sm" data-testid="ec-clear-all" @click="clearAll">
            {{ $t('dialogs.categoryExclusions.clearAll') }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-1.5" data-testid="ec-chips">
          <button
            v-for="category in visibleChips"
            :key="category.id"
            type="button"
            class="bg-muted hover:border-warning-text hover:text-warning-text inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-2.5 text-xs font-medium"
            :aria-label="$t('dialogs.categoryExclusions.stopExcluding', { name: category.name })"
            @click="handleToggle({ categoryId: category.id })"
          >
            <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: category.color }" />
            <span class="truncate">{{ category.name }}</span>
            <XIcon class="size-3 shrink-0" />
          </button>

          <span v-if="overflowChipsCount" class="text-muted-foreground text-xs" data-testid="ec-chips-overflow">
            {{ $t('dialogs.categoryExclusions.andMore', { count: overflowChipsCount }) }}
          </span>
        </div>
      </div>
      <p v-else class="text-muted-foreground text-xs">
        {{ $t('dialogs.categoryExclusions.nothingExcluded') }}
      </p>

      <div
        class="border-input bg-input-background flex h-9 items-center gap-2 rounded-md border px-3 py-2 dark:bg-transparent"
      >
        <SearchIcon class="text-muted-foreground size-4 shrink-0" />
        <input
          ref="inputRef"
          v-model="searchQuery"
          type="text"
          class="min-w-0 flex-1 bg-transparent text-sm outline-none"
          :placeholder="$t('fields.categorySelect.searchPlaceholder')"
        />
        <button
          v-if="searchQuery.length"
          type="button"
          class="text-muted-foreground hover:text-foreground shrink-0"
          data-testid="ec-search-clear"
          @click="searchQuery = ''"
        >
          <XIcon class="size-4" />
        </button>
      </div>

      <ScrollArea class="-mx-1 max-h-96" viewport-class="max-h-96 px-1">
        <ExcludeCategoriesTree
          v-if="visibleTree.length"
          :nodes="visibleTree"
          :excluded-ids="localExcluded"
          :descendants-by-id="descendantsById"
          @toggle="handleToggle"
        />
        <p v-else class="text-muted-foreground p-4 text-center text-sm">
          {{ $t('fields.categorySelect.noCategoriesFound') }}
        </p>
      </ScrollArea>
    </div>

    <template #footer>
      <!-- The drawer closes on swipe-down, so Cancel would only cost vertical space there. -->
      <Button v-if="!isMobile" variant="ghost" @click="isOpen = false">
        {{ $t('common.actions.cancel') }}
      </Button>
      <Button :class="{ 'w-full': isMobile }" data-testid="ec-save-btn" @click="save">
        {{ $t('common.actions.save') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>

<script lang="ts" setup>
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { useCategoriesStore } from '@/stores';
import { CATEGORY_TYPES } from '@bt/shared/types';
import { SearchIcon, XIcon } from '@lucide/vue';
import { useVModel } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';

import ExcludeCategoriesTree from './exclude-categories-tree.vue';
import { buildDescendantMap, filterCategoryTree, toggleExclusion } from './helpers';

const props = defineProps<{
  open?: boolean;
  excludedCategoryIds: string[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  save: [payload: { categoryIds: string[] }];
}>();

const isOpen = useVModel(props, 'open', emit, { passive: true });

// Same breakpoint ResponsiveDialog uses to switch to a drawer, so the footer can't fall out of sync.
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const { formattedCategories, categoriesMap } = storeToRefs(useCategoriesStore());

const localExcluded = ref<string[]>([]);
const searchQuery = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

watch(isOpen, (open) => {
  if (!open) return;

  localExcluded.value = [...props.excludedCategoryIds];
  searchQuery.value = '';
  nextTick(() => inputRef.value?.focus());
});

// Internal categories (transfers, system rows) sink to the bottom: nobody hides those first.
const sortedCategories = computed(() =>
  [...formattedCategories.value].sort((a, b) => {
    if (a.type === CATEGORY_TYPES.internal && b.type !== CATEGORY_TYPES.internal) return 1;
    if (a.type !== CATEGORY_TYPES.internal && b.type === CATEGORY_TYPES.internal) return -1;
    return 0;
  }),
);

const descendantsById = computed(() => buildDescendantMap({ categories: sortedCategories.value }));

const visibleTree = computed(() =>
  filterCategoryTree({ categories: sortedCategories.value, query: searchQuery.value }),
);

const excludedCategories = computed(() =>
  localExcluded.value.map((id) => categoriesMap.value[id]).filter((category) => category !== undefined),
);

// Past this the strip wraps to three-plus rows and pushes the list it is describing off screen.
const MAX_VISIBLE_CHIPS = 5;

const visibleChips = computed(() => excludedCategories.value.slice(0, MAX_VISIBLE_CHIPS));
const overflowChipsCount = computed(() => excludedCategories.value.length - visibleChips.value.length);

const handleToggle = ({ categoryId }: { categoryId: string }) => {
  localExcluded.value = toggleExclusion({
    excludedIds: localExcluded.value,
    categoryId,
    descendantsById: descendantsById.value,
  });
};

const clearAll = () => {
  localExcluded.value = [];
};

const save = () => {
  emit('save', { categoryIds: localExcluded.value });
  isOpen.value = false;
};
</script>
