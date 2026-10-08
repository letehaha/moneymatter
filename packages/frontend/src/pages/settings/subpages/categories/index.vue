<template>
  <div>
    <Card class="max-w-2xl">
      <CardHeader class="flex flex-col gap-2 border-b">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="min-w-0 text-2xl font-semibold">{{ $t('settings.categories.title') }}</h2>

          <Button variant="default" size="sm" class="gap-1.5" @click="openEditDialog()">
            <PlusIcon class="size-4" />
            {{ $t('settings.categories.addButton') }}
          </Button>
        </div>

        <p class="text-sm opacity-80">
          {{ $t('settings.categories.description') }}
          <DocsLink path="/transactions/categories/" />
        </p>
      </CardHeader>

      <CardContent class="mt-6">
        <!-- The toolbar is sticky and scrolls over the tree, so every state it can take needs an
             opaque background. It is a single non-wrapping row with truncating text: state changes
             swap the message but must never change the toolbar height, or the tree shifts mid-drag. -->
        <div
          v-if="!isTouchPointer"
          :class="
            cn([
              'bg-card sticky top-0 z-10 mb-3 flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 transition-colors',
              canDropOnTopLevel && 'border-primary bg-accent border-dashed',
              isTopLevelZoneActive && 'ring-primary ring-2 ring-inset',
            ])
          "
          @dragover="handleTopLevelDragOver"
          @dragleave="isTopLevelZoneActive = false"
          @drop.prevent="handleDropOnTopLevel"
        >
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <template v-if="draggedCategory">
              <span v-if="dragHoverError" class="text-warning-text truncate text-sm">{{ dragHoverError }}</span>
              <span v-else-if="canDropOnTopLevel" class="text-primary-text truncate text-sm">
                {{ $t('settings.categories.dropToTopLevel', { name: draggedCategory.name }) }}
              </span>
              <span v-else class="text-muted-foreground truncate text-sm">
                {{ $t('settings.categories.dropErrors.alreadyTopLevel') }}
              </span>
            </template>

            <template v-else-if="isOrganizing">
              <template v-if="queuedMoves.length">
                <Popover v-model:open="queuePopoverOpen">
                  <PopoverTrigger as-child>
                    <Button variant="soft-primary" size="sm" class="shrink-0 gap-1">
                      {{ $t('settings.categories.movesQueued', queuedMoves.length) }}
                      <ChevronDownIcon class="size-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <!-- Auto-focus would land on the first ✕ button and instantly open its tooltip. -->
                  <PopoverContent align="start" class="w-80 p-1" @open-auto-focus.prevent>
                    <div
                      v-for="move in queuedMoves"
                      :key="move.categoryId"
                      class="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                    >
                      <span class="truncate">{{ move.name }}</span>
                      <span class="text-muted-foreground truncate">→ {{ move.destinationName }}</span>
                      <DesktopOnlyTooltip :content="$t('settings.categories.unqueueMove')">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          class="ml-auto size-7 shrink-0"
                          @click="unqueueMove(move.categoryId)"
                        >
                          <XIcon class="size-3.5" />
                        </Button>
                      </DesktopOnlyTooltip>
                    </div>
                  </PopoverContent>
                </Popover>
                <span v-if="queuedMoves.length === 1" class="text-muted-foreground truncate text-sm">
                  {{ queuedMoves[0]?.name }} → {{ queuedMoves[0]?.destinationName }}
                </span>
              </template>
              <span v-else class="text-muted-foreground truncate text-sm">{{
                $t('settings.categories.organizeHint')
              }}</span>
            </template>

            <span v-else class="text-muted-foreground truncate text-sm">
              {{ $t('settings.categories.categoriesCount', ownCategories.length) }}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <template v-if="isOrganizing">
              <Button variant="ghost" size="sm" :disabled="isSavingMoves" @click="cancelOrganizing">
                {{ $t('common.actions.cancel') }}
              </Button>
              <Button
                size="sm"
                class="gap-1.5"
                :disabled="!queuedMoves.length || isSavingMoves"
                @click="savePendingMoves"
              >
                <LoaderCircleIcon v-if="isSavingMoves" class="size-4 animate-spin" />
                {{ $t('settings.categories.saveChanges') }}
              </Button>
            </template>
            <Button v-else variant="outline" size="sm" @click="isOrganizing = true">
              {{ $t('settings.categories.organizeButton') }}
            </Button>
          </div>
        </div>

        <div class="grid gap-2">
          <template v-if="localCategories.length">
            <Accordion
              :categories="localCategories"
              :expanded-categories="expandedCategories"
              :max-level="MAX_CATEGORIES_NESTING"
              :current-level="1"
              :active-category-id="selectedCategoryId"
              show-actions
              :draggable="isOrganizing"
              :dragged-category-id="draggedCategory?.id ?? null"
              :drop-error="categoryDropErrorMessage"
              @toggle="toggleCategory"
              @select="selectCategory"
              @edit="openEditDialog"
              @move="openMoveDialog"
              @add-subcategory="openAddSubcategoryDialog"
              @delete="openDeleteConfirmation"
              @view-transactions="viewCategoryTransactions"
              @view-analytics="viewCategoryAnalytics"
              @drag-start="handleDragStart"
              @drag-end="handleDragEnd"
              @drag-over-error="dragHoverError = $event"
              @drop="handleDropOnCategory"
            />
          </template>
          <template v-else>
            <div class="text-muted-foreground py-8 text-center">
              {{ $t('settings.categories.empty') }}
            </div>
          </template>
        </div>
      </CardContent>
    </Card>

    <CategoryFormDialog
      v-model:open="dialogState.isOpen"
      :key="dialogState.key"
      :category="dialogState.category"
      :parent-category="dialogState.parentCategory"
      @saved="handleCategorySaved"
    />

    <MoveCategoryDialog
      v-model:open="moveDialogState.isOpen"
      :category="moveDialogState.category"
      @moved="handleCategoryMoved"
    />

    <AlertDialog v-model:open="deleteDialogState.isOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ $t('settings.categories.delete.title') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ $t('settings.categories.delete.description', { name: deleteDialogState.category?.name }) }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ $t('settings.categories.delete.cancelButton') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="handleDeleteCategory">
            {{ $t('settings.categories.delete.deleteButton') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <ReassignCategoryDialog
      v-model:open="reassignDialogState.isOpen"
      :category="reassignDialogState.category!"
      :transaction-count="reassignDialogState.transactionCount"
      @deleted="handleReassignDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { deleteCategory as apiDeleteCategory, editCategory, getCategoryTransactionCount } from '@/api';
import { type FormattedCategory } from '@/common/types';
import Accordion from '@/components/common/accordion/accordion.vue';
import DocsLink from '@/components/common/docs-link.vue';
import CategoryFormDialog from '@/components/dialogs/category-form-dialog.vue';
import ReassignCategoryDialog from '@/components/dialogs/reassign-category-dialog.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/lib/ui/alert-dialog';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useCategoriesStore } from '@/stores';
import { buildCategoriesObjectGraph } from '@/stores/categories/helpers';
import { MAX_CATEGORIES_NESTING, API_ERROR_CODES, type RecordId } from '@bt/shared/types';
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon, XIcon } from '@lucide/vue';
import { useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { type PendingCategoryMove, applyPendingMoves, netMoves, sanitizeMoves } from './apply-pending-moves';
import { type CategoryDropError, categoryDropError } from './can-drop-category';
import MoveCategoryDialog from './components/move-category-dialog.vue';

defineOptions({
  name: 'settings-categories',
});

const { t } = useI18n();
const router = useRouter();
const categoriesStore = useCategoriesStore();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

const { ownCategories, categoriesMap, formattedCategories } = storeToRefs(categoriesStore);

const expandedCategories = ref<string[]>([]);
const selectedCategoryId = ref<string | null>(null);

const pendingMoves = ref<PendingCategoryMove[]>([]);

const localCategories = computed<FormattedCategory[]>(() =>
  pendingMoves.value.length
    ? buildCategoriesObjectGraph(applyPendingMoves({ categories: ownCategories.value, moves: pendingMoves.value }))
    : formattedCategories.value,
);

const dialogState = reactive<{
  isOpen: boolean;
  key: number;
  category?: FormattedCategory;
  parentCategory?: FormattedCategory;
}>({
  isOpen: false,
  key: 0,
  category: undefined,
  parentCategory: undefined,
});

const deleteDialogState = reactive<{
  isOpen: boolean;
  category?: FormattedCategory;
}>({
  isOpen: false,
  category: undefined,
});

const reassignDialogState = reactive<{
  isOpen: boolean;
  category?: FormattedCategory;
  transactionCount: number;
}>({
  isOpen: false,
  category: undefined,
  transactionCount: 0,
});

const toggleCategory = (category: FormattedCategory) => {
  const categoryId = category.id;
  const index = expandedCategories.value.indexOf(categoryId);

  if (category.parentId === null && !expandedCategories.value.includes(category.id)) {
    expandedCategories.value = [];
  }

  if (index === -1) {
    expandedCategories.value.push(categoryId);
  } else {
    expandedCategories.value.splice(index, 1);
  }

  selectedCategoryId.value = categoryId;
};

const selectCategory = (category: FormattedCategory) => {
  selectedCategoryId.value = category.id;
};

const viewCategoryTransactions = (category: FormattedCategory) => {
  router.push({
    name: ROUTES_NAMES.transactions,
    query: { categoryIds: String(category.id) },
  });
};

const viewCategoryAnalytics = (category: FormattedCategory) => {
  router.push({
    name: ROUTES_NAMES.analyticsTrendsComparison,
    query: { categoryIds: String(category.id) },
  });
};

const openEditDialog = (category?: FormattedCategory) => {
  dialogState.category = category;
  dialogState.parentCategory = undefined;
  dialogState.key++;
  dialogState.isOpen = true;
};

const openAddSubcategoryDialog = (parentCategory: FormattedCategory) => {
  dialogState.category = undefined;
  dialogState.parentCategory = parentCategory;
  dialogState.key++;
  dialogState.isOpen = true;
};

// A dialog save applies immediately while drags queue, so stale queued moves for the
// saved category are dropped to keep the two paths from disagreeing on Save.
const handleCategorySaved = (category: FormattedCategory) => {
  unqueueMove(category.id);
  dialogState.isOpen = false;
};

const moveDialogState = reactive<{
  isOpen: boolean;
  category?: FormattedCategory;
}>({
  isOpen: false,
  category: undefined,
});

const openMoveDialog = (category: FormattedCategory) => {
  moveDialogState.category = category;
  moveDialogState.isOpen = true;
};

const handleCategoryMoved = (category: FormattedCategory) => {
  unqueueMove(category.id);
};

const openDeleteConfirmation = async (category: FormattedCategory) => {
  try {
    const { transactionCount } = await getCategoryTransactionCount({ categoryId: category.id });

    if (transactionCount > 0) {
      reassignDialogState.category = category;
      reassignDialogState.transactionCount = transactionCount;
      reassignDialogState.isOpen = true;
    } else {
      deleteDialogState.category = category;
      deleteDialogState.isOpen = true;
    }
  } catch {
    addErrorNotification(t('settings.categories.notifications.checkFailed'));
  }
};

const handleDeleteCategory = async () => {
  if (!deleteDialogState.category) return;

  try {
    await apiDeleteCategory({ categoryId: deleteDialogState.category.id });
    await categoriesStore.loadCategories({ force: true });
    addSuccessNotification(t('settings.categories.notifications.deleteSuccess'));

    if (selectedCategoryId.value === deleteDialogState.category.id) {
      selectedCategoryId.value = null;
    }
  } catch (err) {
    if (err instanceof ApiErrorResponseError) {
      if (err.data.code === API_ERROR_CODES.validationError) {
        addErrorNotification(err.data.message ?? '');
        return;
      }
    }
    addErrorNotification(t('settings.categories.notifications.deleteFailed'));
  } finally {
    deleteDialogState.isOpen = false;
    deleteDialogState.category = undefined;
  }
};

const draggedCategory = ref<FormattedCategory | null>(null);
const isTopLevelZoneActive = ref(false);
const isSavingMoves = ref(false);
const isOrganizing = ref(false);
// Native HTML5 drag never fires from touch input, so coarse-pointer devices skip
// Organize mode; there, moving happens via "Move to…" and the Edit dialog.
const isTouchPointer = useMediaQuery('(pointer: coarse)');
const dragHoverError = ref<string | null>(null);
const queuePopoverOpen = ref(false);

const queuedMoves = computed(() =>
  netMoves({ moves: pendingMoves.value, categories: ownCategories.value }).map((move) => ({
    ...move,
    name: categoriesMap.value[move.categoryId]?.name ?? '',
    destinationName: move.parentId
      ? (categoriesMap.value[move.parentId]?.name ?? '')
      : t('settings.categories.topLevel'),
  })),
);

// Re-validate on every queue mutation: each queued move was validated against the tree
// its predecessors produced, so removing or invalidating one entry can leave survivors
// that cycle or orphan, and an inconsistent queue renders a broken tree.
const setPendingMoves = (moves: PendingCategoryMove[]) => {
  const sanitized = sanitizeMoves({ categories: ownCategories.value, moves, maxNesting: MAX_CATEGORIES_NESTING });
  const dropped = moves.length - sanitized.length;
  if (dropped > 0) {
    addErrorNotification(t('settings.categories.notifications.staleMovesRemoved', dropped));
  }
  pendingMoves.value = sanitized;
  if (!sanitized.length) queuePopoverOpen.value = false;
};

const unqueueMove = (categoryId: RecordId) => {
  setPendingMoves(pendingMoves.value.filter((move) => move.categoryId !== categoryId));
};

// A reload can invalidate queued moves (a category deleted, a dialog edit applied), so
// re-check the queue against every fresh tree.
watch(ownCategories, () => {
  if (pendingMoves.value.length) setPendingMoves(pendingMoves.value);
});

const cancelOrganizing = () => {
  pendingMoves.value = [];
  queuePopoverOpen.value = false;
  isOrganizing.value = false;
};

const canDropOnTopLevel = computed(
  () =>
    !!draggedCategory.value &&
    categoryDropError({ dragged: draggedCategory.value, target: null, maxNesting: MAX_CATEGORIES_NESTING }) === null,
);

// 'self' maps to no message: the source row is already dimmed, a chip there is noise.
const DROP_ERROR_MESSAGE_KEYS: Partial<Record<CategoryDropError, string>> = {
  'current-parent': 'settings.categories.dropErrors.currentParent',
  'inside-itself': 'settings.categories.dropErrors.insideItself',
  'internal-target': 'settings.categories.dropErrors.internalTarget',
  'too-deep': 'settings.categories.dropErrors.tooDeep',
  'children-too-deep': 'settings.categories.dropErrors.childrenTooDeep',
};

const categoryDropErrorMessage = ({ target, depth }: { target: FormattedCategory; depth: number }): string | null => {
  if (!draggedCategory.value) return '';

  const reason = categoryDropError({
    dragged: draggedCategory.value,
    target,
    targetDepth: depth,
    maxNesting: MAX_CATEGORIES_NESTING,
  });

  if (reason === null) return null;

  const key = DROP_ERROR_MESSAGE_KEYS[reason];
  return key ? t(key, { max: MAX_CATEGORIES_NESTING }) : '';
};

const handleDragStart = (category: FormattedCategory) => {
  draggedCategory.value = category;
};

const handleDragEnd = () => {
  draggedCategory.value = null;
  isTopLevelZoneActive.value = false;
  dragHoverError.value = null;
};

const handleTopLevelDragOver = (event: DragEvent) => {
  if (!canDropOnTopLevel.value) return;

  event.preventDefault();
  isTopLevelZoneActive.value = true;
};

const queueMove = ({ parentId }: { parentId: RecordId | null }) => {
  const dragged = draggedCategory.value;

  handleDragEnd();

  if (!dragged) return;

  pendingMoves.value.push({ categoryId: dragged.id, parentId });

  if (parentId && !expandedCategories.value.includes(parentId)) {
    expandedCategories.value.push(parentId);
  }
};

const handleDropOnCategory = (target: FormattedCategory) => queueMove({ parentId: target.id });

const handleDropOnTopLevel = () => queueMove({ parentId: null });

const savePendingMoves = async () => {
  if (!pendingMoves.value.length || isSavingMoves.value) return;

  const moves = [...pendingMoves.value];
  isSavingMoves.value = true;

  let completed = 0;
  let failure: unknown = null;

  try {
    // Each move was validated against the tree its predecessors produced, so replaying
    // them out of order or in parallel can trip the nesting limit server-side.
    for (const move of moves) {
      try {
        await editCategory({ categoryId: move.categoryId, parentId: move.parentId });
        completed += 1;
      } catch (err) {
        failure = err;
        break;
      }
    }

    // On failure the completed prefix is already persisted; the failed move is reported
    // and dropped, while moves that never ran stay queued for re-validation after reload.
    pendingMoves.value = failure ? moves.slice(completed + 1) : [];
    await categoriesStore.loadCategories({ force: true });

    if (failure) {
      addErrorNotification(
        failure instanceof ApiErrorResponseError && failure.data.message
          ? failure.data.message
          : t('settings.categories.notifications.moveFailed'),
      );
    } else {
      addSuccessNotification(t('settings.categories.notifications.saveSuccess'));
      queuePopoverOpen.value = false;
      isOrganizing.value = false;
    }
  } finally {
    isSavingMoves.value = false;
  }
};

const handleReassignDeleted = () => {
  if (reassignDialogState.category && selectedCategoryId.value === reassignDialogState.category.id) {
    selectedCategoryId.value = null;
  }
  reassignDialogState.isOpen = false;
  reassignDialogState.category = undefined;
  reassignDialogState.transactionCount = 0;
};
</script>
