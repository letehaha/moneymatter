<template>
  <div>
    <template v-for="cat in categories" :key="cat.id">
      <div>
        <div
          :class="
            cn([
              'flex items-center gap-1 rounded-md py-0.5 transition-opacity',
              {
                'bg-accent': isActiveCategory(cat),
                'opacity-50': draggedCategoryId === cat.id,
                'opacity-40': isDimmedTarget(cat),
                'bg-accent ring-primary ring-2 ring-inset': isDropTarget({ category: cat, position: 'inside' }),
                'before:bg-primary relative before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:rounded-full':
                  isDropTarget({ category: cat, position: 'before' }),
                'after:bg-primary relative after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full':
                  isDropTarget({ category: cat, position: 'after' }),
              },
            ])
          "
          @dragover.stop="handleDragOver(cat, $event)"
          @dragleave.stop="handleDragLeave(cat, $event)"
          @drop.stop.prevent="handleDrop({ category: cat, event: $event })"
        >
          <span
            v-if="draggable"
            :draggable="isDraggableCategory(cat)"
            :class="
              cn([
                'flex w-4 shrink-0 items-center justify-center self-stretch',
                isDraggableCategory(cat) && 'cursor-grab active:cursor-grabbing',
              ])
            "
            @dragstart.stop="handleDragStart(cat, $event)"
            @dragend.stop="handleDragEnd"
          >
            <GripVerticalIcon
              v-if="isDraggableCategory(cat)"
              class="text-muted-foreground pointer-events-none size-4"
            />
          </span>

          <div
            :class="
              cn([
                'flex flex-1 items-center justify-start gap-2 overflow-hidden rounded-md px-3 py-2 text-sm font-medium',
                isInternalCategory(cat)
                  ? 'cursor-default opacity-70'
                  : 'hover:bg-accent hover:text-accent-foreground cursor-pointer',
              ])
            "
            @click="!isInternalCategory(cat) && handleCategoryClick(cat)"
          >
            <ChevronRightIcon
              class="text-muted-foreground size-4 shrink-0 transition-transform duration-200"
              :class="[
                cat.subCategories.length ? { 'rotate-90': props.expandedCategories.includes(cat.id) } : 'opacity-30',
              ]"
            />

            <CategoryCircle :category="cat" />
            <span class="truncate">{{ cat.name }}</span>
            <span v-if="isInternalCategory(cat)" class="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
              {{ t('common.labels.system') }}
            </span>
          </div>

          <ResponsiveMenu v-if="showActions && !isInternalCategory(cat)" v-model:open="menuOpenState[cat.id]">
            <template #trigger>
              <Button variant="ghost" size="icon-sm" class="size-8 shrink-0" title="Actions" @click.stop>
                <MoreVerticalIcon class="size-4" />
              </Button>
            </template>

            <template #default="{ close }">
              <Button variant="ghost" class="w-full justify-start gap-2" size="sm" @click="handleEdit(cat, close)">
                <PencilIcon class="size-4" />
                {{ t('common.actions.edit') }}
              </Button>

              <Button variant="ghost" class="w-full justify-start gap-2" size="sm" @click="handleMove(cat, close)">
                <FolderInputIcon class="size-4" />
                {{ t('common.actions.moveTo') }}
              </Button>

              <Button
                variant="ghost"
                class="w-full justify-start gap-2"
                size="sm"
                @click="handleViewTransactions(cat, close)"
              >
                <ListIcon class="size-4" />
                {{ t('common.actions.viewTransactions') }}
              </Button>

              <Button
                variant="ghost"
                class="w-full justify-start gap-2"
                size="sm"
                @click="handleViewAnalytics(cat, close)"
              >
                <LineChartIcon class="size-4" />
                {{ t('common.actions.viewAnalytics') }}
              </Button>

              <Button
                v-if="canAddSubcategory"
                variant="ghost"
                class="w-full justify-start gap-2"
                size="sm"
                @click="handleAddSubcategory(cat, close)"
              >
                <PlusIcon class="size-4 shrink-0" />
                {{ t('common.actions.addSubcategory') }}
              </Button>

              <div class="bg-border my-1 h-px" />

              <Button
                variant="ghost"
                class="text-destructive-text hover:text-destructive-text w-full justify-start gap-2"
                size="sm"
                @click="handleDelete(cat, close)"
              >
                <Trash2Icon class="size-4" />
                {{ t('common.actions.delete') }}
              </Button>
            </template>
          </ResponsiveMenu>
        </div>

        <div
          v-if="props.expandedCategories.includes(cat.id) && cat.subCategories && cat.subCategories.length"
          class="ml-6 border-l pl-4"
        >
          <Accordion
            v-if="cat.subCategories.length"
            :categories="cat.subCategories"
            :expanded-categories="props.expandedCategories"
            :max-level="maxLevel"
            :current-level="currentLevel + 1"
            :active-category-id="activeCategoryId"
            :show-actions="showActions"
            :draggable="draggable"
            :dragged-category-id="draggedCategoryId"
            :drop-error="dropError"
            @toggle="(c) => emits('toggle', c)"
            @select="selectCategory"
            @edit="(c) => emits('edit', c)"
            @move="(c) => emits('move', c)"
            @add-subcategory="(c) => emits('add-subcategory', c)"
            @delete="(c) => emits('delete', c)"
            @view-transactions="(c) => emits('view-transactions', c)"
            @view-analytics="(c) => emits('view-analytics', c)"
            @drag-start="(c) => emits('drag-start', c)"
            @drag-end="() => emits('drag-end')"
            @drag-over-error="(msg) => emits('drag-over-error', msg)"
            @drop="(payload) => emits('drop', payload)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { type CategoryDropPosition, FormattedCategory } from '@/common/types';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import { CATEGORY_TYPES } from '@bt/shared/types';
import {
  ChevronRightIcon,
  FolderInputIcon,
  GripVerticalIcon,
  LineChartIcon,
  ListIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from '@lucide/vue';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const isInternalCategory = (category: FormattedCategory) => category.type === CATEGORY_TYPES.internal;

const DROP_POSITIONS: CategoryDropPosition[] = ['before', 'inside', 'after'];
/** Share of the row height at its top and bottom edges that reorders instead of nesting. */
const EDGE_ZONE = 1 / 3;

const props = withDefaults(
  defineProps<{
    categories: FormattedCategory[];
    expandedCategories: string[];
    maxLevel: number;
    currentLevel: number;
    activeCategoryId: string | null | undefined;
    showActions?: boolean;
    draggable?: boolean;
    draggedCategoryId?: string | null;
    /**
     * `null` allows the drop; a string forbids it and is reported via `drag-over-error`
     * when non-empty (`''` forbids without a message). No validator means all drops are
     * allowed and emitted.
     */
    dropError?: (params: { target: FormattedCategory; depth: number; position: CategoryDropPosition }) => string | null;
  }>(),
  {
    showActions: false,
    draggable: false,
    draggedCategoryId: null,
  },
);

const emits = defineEmits<{
  toggle: [category: FormattedCategory];
  select: [category: FormattedCategory];
  edit: [category: FormattedCategory];
  move: [category: FormattedCategory];
  'add-subcategory': [category: FormattedCategory];
  delete: [category: FormattedCategory];
  'view-transactions': [category: FormattedCategory];
  'view-analytics': [category: FormattedCategory];
  'drag-start': [category: FormattedCategory];
  'drag-end': [];
  'drag-over-error': [message: string | null];
  drop: [payload: { target: FormattedCategory; position: CategoryDropPosition }];
}>();

const menuOpenState = reactive<Record<string, boolean>>({});
const dragOverId = ref<string | null>(null);
const dropPosition = ref<CategoryDropPosition>('inside');
const reportedErrorId = ref<string | null>(null);

const canAddSubcategory = computed(() => props.currentLevel < props.maxLevel);

const handleCategoryClick = (category: FormattedCategory) => {
  if (category.subCategories.length) {
    emits('toggle', category);
  } else if (props.showActions) {
    menuOpenState[category.id] = true;
  }
};

const isActiveCategory = (category: FormattedCategory) => category.id === props.activeCategoryId;

const selectCategory = (category: FormattedCategory) => {
  emits('select', category);
};

const handleEdit = (category: FormattedCategory, close: () => void) => {
  close();
  emits('edit', category);
};

const handleMove = (category: FormattedCategory, close: () => void) => {
  close();
  emits('move', category);
};

const handleAddSubcategory = (category: FormattedCategory, close: () => void) => {
  close();
  emits('add-subcategory', category);
};

const handleDelete = (category: FormattedCategory, close: () => void) => {
  close();
  emits('delete', category);
};

const handleViewTransactions = (category: FormattedCategory, close: () => void) => {
  close();
  emits('view-transactions', category);
};

const handleViewAnalytics = (category: FormattedCategory, close: () => void) => {
  close();
  emits('view-analytics', category);
};

const isDraggableCategory = (category: FormattedCategory) => props.draggable && !isInternalCategory(category);

const isDropTarget = ({ category, position }: { category: FormattedCategory; position: CategoryDropPosition }) =>
  !!props.draggedCategoryId && dragOverId.value === category.id && dropPosition.value === position;

const positionFromEvent = (event: DragEvent): CategoryDropPosition => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const offset = event.clientY - rect.top;
  if (offset < rect.height * EDGE_ZONE) return 'before';
  if (offset > rect.height * (1 - EDGE_ZONE)) return 'after';
  return 'inside';
};

const resolveDropError = ({
  category,
  position,
}: {
  category: FormattedCategory;
  position: CategoryDropPosition;
}): string | null => {
  if (!props.draggable) return '';
  return props.dropError ? props.dropError({ target: category, depth: props.currentLevel, position }) : null;
};

const isDimmedTarget = (category: FormattedCategory) =>
  !!props.draggedCategoryId &&
  props.draggedCategoryId !== category.id &&
  DROP_POSITIONS.every((position) => resolveDropError({ category, position }) !== null);

const clearReportedError = () => {
  if (reportedErrorId.value === null) return;
  reportedErrorId.value = null;
  emits('drag-over-error', null);
};

const handleDragStart = (category: FormattedCategory, event: DragEvent) => {
  if (!isDraggableCategory(category)) return;

  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', category.id);
    event.dataTransfer.effectAllowed = 'move';

    // Without this the ghost is just the grip icon the gesture started on.
    const row = (event.currentTarget as HTMLElement).parentElement;
    if (row) event.dataTransfer.setDragImage(row, 0, row.offsetHeight / 2);
  }

  // Deferred: the emit re-renders the page (pending-moves bar appears above the tree), and
  // Chromium cancels a drag whose source reflows while dragstart is still being processed.
  window.setTimeout(() => emits('drag-start', category));
};

const handleDragEnd = () => {
  dragOverId.value = null;
  clearReportedError();
  emits('drag-end');
};

const handleDragOver = (category: FormattedCategory, event: DragEvent) => {
  const position = positionFromEvent(event);
  const error = resolveDropError({ category, position });

  if (error === null) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverId.value = category.id;
    dropPosition.value = position;
    clearReportedError();
    return;
  }

  dragOverId.value = null;
  // Guarded because dragover fires continuously while hovering one row.
  const errorKey = `${category.id}:${position}`;
  if (reportedErrorId.value !== errorKey) {
    reportedErrorId.value = errorKey;
    emits('drag-over-error', error || null);
  }
};

const handleDragLeave = (category: FormattedCategory, event: DragEvent) => {
  const nextTarget = event.relatedTarget as Node | null;
  if (nextTarget && (event.currentTarget as HTMLElement).contains(nextTarget)) return;

  if (dragOverId.value === category.id) dragOverId.value = null;
  if (reportedErrorId.value?.startsWith(`${category.id}:`)) clearReportedError();
};

const handleDrop = ({ category, event }: { category: FormattedCategory; event: DragEvent }) => {
  const position = positionFromEvent(event);
  dragOverId.value = null;
  clearReportedError();
  if (resolveDropError({ category, position }) !== null) return;

  emits('drop', { target: category, position });
};
</script>
