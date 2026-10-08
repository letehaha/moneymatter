<!-- eslint-disable vuejs-accessibility/aria-role -->
<template>
  <!-- Reusable category list template -->
  <CategoryListTemplate>
    <div role="listbox">
      <template v-for="(item, index) in filteredItems" :key="item.id">
        <!-- Group separator (shown only when searching) -->
        <div
          v-if="shouldShowSeparator({ item, index })"
          class="text-muted-foreground flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-medium"
          :class="{ 'pt-1': index === 0 }"
        >
          <span class="shrink-0">{{ item.rootParentName }}</span>
          <div class="bg-border h-px flex-1" />
        </div>

        <button
          class="text-popover-foreground hover:bg-popover-foreground/10 relative flex w-full cursor-pointer items-center gap-2 border-none p-2 text-left text-sm leading-tight transition-colors duration-300 ease-out"
          type="button"
          :class="{ 'bg-primary/15 hover:bg-primary/20': selectedValue?.id === item.id }"
          :style="{ paddingLeft: `${16 + (isSearching ? 0 : item.depth) * 12}px` }"
          role="option"
          :aria-selected="selectedValue?.id === item.id"
          @mousedown.prevent="selectItem(item)"
        >
          <CategoryCircle :category="item" :categories-map="categoriesMap" class="shrink-0" />
          <span class="min-w-0 grow truncate">{{ item.name }}</span>
        </button>
      </template>

      <div v-if="filteredItems.length === 0" class="text-muted-foreground p-4 text-center text-sm">
        {{ $t('fields.categorySelect.noCategoriesFound') }}
      </div>
    </div>
  </CategoryListTemplate>

  <div
    :class="{
      'category-select-field--disabled': disabled,
      'category-select-field--active': isOpen,
    }"
    class="relative w-full flex-1"
    data-test="category-select-field"
    role="select"
  >
    <FieldLabel :label="label" only-template>
      <template v-if="$slots['label-right']" #label-right>
        <slot name="label-right" />
      </template>

      <!-- PopoverRoot renders no DOM element, so with `field-right` content the trigger button
           and the addon become direct flex children and share one joined outline. -->
      <div :class="cn($slots['field-right'] && 'flex items-stretch')">
        <!-- Desktop: Popover -->
        <template v-if="!isMobile">
          <Popover.Popover :open="isOpen" @update:open="(open: boolean) => (isOpen = open)">
            <Popover.PopoverTrigger as-child>
              <button
                ref="triggerRef"
                type="button"
                :disabled="disabled"
                :class="
                  cn(
                    'border-input bg-input-background ring-offset-background flex h-10 w-full items-center gap-2 rounded-md border px-3 py-2 text-sm md:h-9',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                    disabled && 'cursor-not-allowed opacity-50',
                    $slots['field-right'] && 'min-w-0 flex-1 rounded-r-none border-r-0',
                    $attrs.class ?? '',
                  )
                "
                :aria-label="$t('fields.categorySelect.selectCategoryLabel')"
                :title="selectedValue?.name || $t('fields.categorySelect.selectCategoryLabel')"
              >
                <CategoryCircle
                  v-if="selectedValue"
                  :category="selectedValue"
                  :categories-map="categoriesMap"
                  class="shrink-0"
                />
                <span
                  class="text-muted-foreground min-w-0 flex-1 truncate text-left"
                  :class="{ 'text-foreground': selectedValue }"
                >
                  {{ selectedValue?.name || placeholder }}
                </span>
                <span
                  v-if="selectedValue && !disabled"
                  role="button"
                  tabindex="0"
                  class="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                  :aria-label="$t('fields.categorySelect.clearSelectionLabel')"
                  @click="clearSelection"
                  @keydown.enter.prevent="clearSelection"
                >
                  <XIcon class="size-4" />
                </span>
                <ChevronDownIcon
                  class="text-popover-foreground size-5 shrink-0 transition-transform duration-150 ease-out"
                  :class="{ 'rotate-180': isOpen }"
                />
              </button>
            </Popover.PopoverTrigger>
            <Popover.PopoverContent
              align="start"
              :class="
                cn(
                  'w-(--reka-popover-trigger-width) max-w-(--reka-popover-trigger-width) min-w-(--reka-popover-trigger-width) p-0',
                  popoverClassName,
                )
              "
              @open-auto-focus.prevent="$nextTick(() => inputRef?.focus())"
            >
              <div
                v-if="sharedOwnerHandle"
                class="bg-muted/40 text-foreground flex items-center gap-2 border-b px-3 py-2 text-xs"
                role="note"
              >
                <span>{{ $t('fields.categorySelect.sharedOwnerNotice', { owner: sharedOwnerHandle }) }}</span>
                <ResponsiveTooltip
                  :content="$t('fields.categorySelect.sharedOwnerNoticeTooltip', { owner: sharedOwnerHandle })"
                  content-class-name="max-w-64"
                  :delay-duration="100"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 shrink-0 cursor-help" />
                </ResponsiveTooltip>
              </div>
              <!-- Search input -->
              <input
                ref="inputRef"
                v-model="searchQuery"
                type="text"
                class="w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
                :placeholder="$t('fields.categorySelect.searchPlaceholder')"
                :aria-label="$t('fields.categorySelect.searchCategoryLabel')"
              />
              <!-- Category list -->
              <div ref="listRef" class="max-h-87.5 overflow-auto">
                <CategoryListContent />
              </div>
            </Popover.PopoverContent>
          </Popover.Popover>
        </template>

        <!-- Mobile: Button + Drawer -->
        <template v-else>
          <button
            ref="triggerRef"
            type="button"
            :disabled="disabled"
            :class="
              cn(
                'border-input bg-input-background ring-offset-background flex h-10 w-full items-center gap-2 rounded-md border px-3 py-2 text-sm md:h-9',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                disabled && 'cursor-not-allowed opacity-50',
                $slots['field-right'] && 'min-w-0 flex-1 rounded-r-none border-r-0',
                $attrs.class ?? '',
              )
            "
            :aria-label="$t('fields.categorySelect.selectCategoryLabel')"
            :title="selectedValue?.name || $t('fields.categorySelect.selectCategoryLabel')"
            @click="openDropdown"
          >
            <CategoryCircle
              v-if="selectedValue"
              :category="selectedValue"
              :categories-map="categoriesMap"
              class="shrink-0"
            />
            <span
              class="text-muted-foreground min-w-0 flex-1 truncate text-left"
              :class="{ 'text-foreground': selectedValue }"
            >
              {{ selectedValue?.name || placeholder }}
            </span>
            <button
              v-if="selectedValue && !disabled"
              type="button"
              class="text-muted-foreground hover:text-foreground shrink-0"
              :aria-label="$t('fields.categorySelect.clearSelectionLabel')"
              @click="clearSelection"
            >
              <XIcon class="size-4" />
            </button>
            <ChevronDownIcon
              class="text-popover-foreground size-5 shrink-0 transition-transform duration-150 ease-out"
              :class="{ 'rotate-180': isOpen }"
            />
          </button>
        </template>

        <slot name="field-right" />
      </div>
    </FieldLabel>

    <FieldError :error-message="errorMessage" />

    <!-- Mobile: Drawer -->
    <Drawer.Drawer v-if="isMobile" :open="isOpen" @update:open="handleDrawerOpenChange">
      <Drawer.DrawerContent class="px-4 pb-4">
        <Drawer.DrawerHeader class="px-0 pb-2">
          <Drawer.DrawerTitle>{{ $t('fields.categorySelect.selectCategoryLabel') }}</Drawer.DrawerTitle>
        </Drawer.DrawerHeader>

        <div
          v-if="sharedOwnerHandle"
          class="bg-muted/40 text-foreground mb-3 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs"
          role="note"
        >
          <span>{{ $t('fields.categorySelect.sharedOwnerNotice', { owner: sharedOwnerHandle }) }}</span>
          <ResponsiveTooltip
            :content="$t('fields.categorySelect.sharedOwnerNoticeTooltip', { owner: sharedOwnerHandle })"
            content-class-name="max-w-64"
            :delay-duration="100"
          >
            <InfoIcon class="text-muted-foreground size-3.5 shrink-0 cursor-help" />
          </ResponsiveTooltip>
        </div>

        <!-- Search input in drawer -->
        <div
          class="border-input bg-input-background mb-3 flex h-10 w-full items-center gap-2 rounded-md border px-3 py-2 text-sm md:h-9"
        >
          <input
            ref="drawerInputRef"
            v-model="searchQuery"
            type="text"
            class="min-w-0 flex-1 bg-transparent outline-none"
            :placeholder="selectedValue?.name || $t('fields.categorySelect.searchPlaceholder')"
            :aria-label="$t('fields.categorySelect.searchCategoryLabel')"
          />

          <button
            v-if="searchQuery.length"
            type="button"
            class="text-muted-foreground hover:text-foreground shrink-0"
            :aria-label="$t('fields.categorySelect.clearSearchLabel')"
            @click="searchQuery = ''"
          >
            <XIcon class="size-4" />
          </button>
        </div>

        <!-- Category list -->
        <div class="h-[50vh] overflow-auto">
          <CategoryListContent />
        </div>
      </Drawer.DrawerContent>
    </Drawer.Drawer>
  </div>
</template>

<script setup lang="ts">
import { type FormattedCategory } from '@/common/types';
import { truncateOwnerUsername } from '@/common/utils/account-display';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import * as Drawer from '@/components/lib/ui/drawer';
import * as Popover from '@/components/lib/ui/popover';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import { CATEGORY_TYPES, type CategoryModel } from '@bt/shared/types';
import { createReusableTemplate } from '@vueuse/core';
import { ChevronDownIcon, InfoIcon, XIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const [CategoryListTemplate, CategoryListContent] = createReusableTemplate();

interface FlatCategory extends FormattedCategory {
  depth: number;
  rootParentId: string;
  rootParentName: string;
}

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue?: FormattedCategory | null;
    labelKey?: string | ((value: FormattedCategory) => string);
    values: FormattedCategory[];
    placeholder?: string;
    errorMessage?: string;
    disabled?: boolean;
    /** Forwarded to inner CategoryCircle so icon inheritance walks the right tree. */
    categoriesMap?: Record<string, CategoryModel>;
    /**
     * When set, surfaces a "Showing @{owner}'s categories" notice atop the dropdown so
     * recipients on a shared account aren't confused by suddenly seeing a different
     * category set than the global Pinia store would render.
     */
    sharedOwnerUsername?: string;
    popoverClassName?: string;
  }>(),
  {
    label: undefined,
    modelValue: undefined,
    placeholder: undefined,
    errorMessage: undefined,
    labelKey: 'label',
    categoriesMap: undefined,
    sharedOwnerUsername: undefined,
    popoverClassName: undefined,
  },
);

const sharedOwnerHandle = computed(() =>
  props.sharedOwnerUsername ? `@${truncateOwnerUsername(props.sharedOwnerUsername)}` : null,
);

const emit = defineEmits<{
  'update:model-value': [value: FormattedCategory | null];
}>();

const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const selectedValue = ref<FormattedCategory | null>(props.modelValue ?? null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const drawerInputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const searchQuery = ref('');
const isOpen = ref(false);

watch(
  () => props.modelValue,
  (value) => {
    if (value === null) {
      selectedValue.value = null;
    } else if (value && value.id !== selectedValue.value?.id) {
      selectedValue.value = value;
    }
  },
  { deep: true },
);

const flattenCategories = ({
  categories,
  depth = 0,
  rootParent,
}: {
  categories: FormattedCategory[];
  depth?: number;
  rootParent?: { id: string; name: string };
}): FlatCategory[] => {
  const result: FlatCategory[] = [];

  for (const category of categories) {
    const currentRoot = rootParent ?? { id: category.id, name: category.name };

    result.push({
      ...category,
      depth,
      rootParentId: currentRoot.id,
      rootParentName: currentRoot.name,
    });

    if (category.subCategories?.length > 0) {
      result.push(
        ...flattenCategories({
          categories: category.subCategories,
          depth: depth + 1,
          rootParent: currentRoot,
        }),
      );
    }
  }

  return result;
};

const allFlatCategories = computed(() => {
  // Sort root categories so internal ones are at the bottom
  const sortedValues = [...props.values].sort((a, b) => {
    if (a.type === CATEGORY_TYPES.internal && b.type !== CATEGORY_TYPES.internal) return 1;
    if (a.type !== CATEGORY_TYPES.internal && b.type === CATEGORY_TYPES.internal) return -1;
    return 0;
  });

  return flattenCategories({ categories: sortedValues });
});

const isSearching = computed(() => searchQuery.value.length > 0);

const filteredItems = computed(() => {
  if (!searchQuery.value) {
    return allFlatCategories.value;
  }

  const query = searchQuery.value.toLowerCase();
  return allFlatCategories.value.filter((category) => category.name.toLowerCase().includes(query));
});

const shouldShowSeparator = ({ item, index }: { item: FlatCategory; index: number }): boolean => {
  if (index === 0) return true;

  const prevItem = filteredItems.value[index - 1];
  return prevItem!.rootParentId !== item.rootParentId;
};

const openDropdown = () => {
  isOpen.value = true;
  searchQuery.value = '';
};

const handleDrawerOpenChange = (open: boolean) => {
  isOpen.value = open;
  if (!open) {
    searchQuery.value = '';
  }
};

const selectItem = (item: FlatCategory) => {
  selectedValue.value = item;
  emit('update:model-value', item);
  isOpen.value = false;
  searchQuery.value = '';
};

const clearSelection = (event: Event) => {
  event.stopPropagation();
  selectedValue.value = null;
  emit('update:model-value', null);
};

// Clear search query when popover closes
watch(isOpen, (value) => {
  if (!value) {
    searchQuery.value = '';
  }
});

defineExpose({
  focus: () => triggerRef.value?.focus(),
  open: openDropdown,
});
</script>
