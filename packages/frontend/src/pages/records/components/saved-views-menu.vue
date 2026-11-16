<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button
        :variant="activeView ? 'soft-primary' : secondaryTrigger ? 'secondary' : 'field'"
        :class="cn('gap-2', block ? 'min-w-0 flex-1 justify-start' : 'max-w-56 min-w-0 shrink')"
      >
        <BookmarkIcon class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate text-left">
          {{ activeView?.name ?? $t('transactions.savedViews.trigger') }}
        </span>
        <span v-if="isModified" class="bg-warning size-1.5 shrink-0 rounded-full">
          <span class="sr-only">{{ $t('transactions.savedViews.modified') }}</span>
        </span>
        <ChevronDownIcon class="size-4 shrink-0" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="start" class="w-80 p-1">
      <ScrollArea class="max-h-72" viewport-class="max-h-72">
        <p v-if="views.length === 0" class="text-muted-foreground px-2 py-3 text-center text-sm">
          {{ $t('transactions.savedViews.empty') }}
        </p>
        <div v-for="(view, index) in views" :key="view.id" class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            :class="
              cn(
                'h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 font-normal',
                view.id === activeView?.id && 'bg-accent hover:bg-accent',
              )
            "
            @click="applyView({ view })"
          >
            <CheckIcon :class="cn('size-4 shrink-0', view.id === activeView?.id ? 'opacity-100' : 'opacity-0')" />
            <span class="flex min-w-0 flex-1 flex-col text-left">
              <span class="truncate">{{ view.name }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ summaries[index] }}</span>
            </span>
            <span v-if="counts[index]?.isLoading" class="bg-muted h-4 w-7 shrink-0 animate-pulse rounded-full" />
            <span
              v-else-if="counts[index]?.data"
              class="bg-muted text-muted-foreground shrink-0 rounded-full px-2 text-xs tabular-nums"
            >
              {{ counts[index]?.data?.count }}
            </span>
          </Button>

          <DesktopOnlyTooltip :content="$t('transactions.savedViews.actions')">
            <span class="inline-flex">
              <Popover>
                <PopoverTrigger as-child>
                  <Button variant="ghost" size="icon-sm" :aria-label="$t('transactions.savedViews.actions')">
                    <EllipsisIcon class="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" class="flex w-44 flex-col p-1">
                  <Button variant="ghost" size="sm" class="justify-start font-normal" @click="openNameDialog({ view })">
                    <PencilIcon class="size-4" />
                    {{ $t('transactions.savedViews.rename') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="justify-start font-normal"
                    :disabled="index === 0 || isPatching"
                    @click="moveView({ index, offset: -1 })"
                  >
                    <ArrowUpIcon class="size-4" />
                    {{ $t('transactions.savedViews.moveUp') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="justify-start font-normal"
                    :disabled="index === views.length - 1 || isPatching"
                    @click="moveView({ index, offset: 1 })"
                  >
                    <ArrowDownIcon class="size-4" />
                    {{ $t('transactions.savedViews.moveDown') }}
                  </Button>
                  <Button
                    variant="ghost-destructive"
                    size="sm"
                    class="justify-start font-normal"
                    @click="openDeleteDialog({ view })"
                  >
                    <Trash2Icon class="size-4" />
                    {{ $t('common.actions.delete') }}
                  </Button>
                </PopoverContent>
              </Popover>
            </span>
          </DesktopOnlyTooltip>
        </div>
      </ScrollArea>

      <div class="border-border mt-1 flex flex-col gap-1 border-t pt-1">
        <Button
          v-if="isModified"
          size="sm"
          class="w-full justify-start"
          :disabled="isPatching"
          :loading="isPatching"
          @click="updateActiveView"
        >
          <span class="truncate">{{ $t('transactions.savedViews.update', { name: activeView?.name }) }}</span>
        </Button>
        <div class="flex gap-1">
          <Button v-if="activeView" variant="secondary" size="sm" class="shrink-0" @click="resetView">
            <RotateCcwIcon class="size-4 shrink-0" />
            <span class="truncate">{{ $t('transactions.filters.reset') }}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            class="min-w-0 flex-1"
            :disabled="!canSaveNew"
            @click="openNameDialog({})"
          >
            <PlusIcon class="size-4 shrink-0" />
            <span class="truncate">{{ $t('transactions.savedViews.saveNew') }}</span>
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>

  <div v-if="block && isModified" class="bg-muted flex w-full items-center gap-1 rounded-md py-1 pr-1 pl-3 text-sm">
    <span class="min-w-0 flex-1 truncate">{{ $t('transactions.savedViews.modified') }}</span>
    <Button variant="ghost-primary" size="sm" :disabled="isPatching" :loading="isPatching" @click="updateActiveView">
      {{ $t('transactions.savedViews.updateShort') }}
    </Button>
    <Button variant="ghost" size="sm" @click="revert">{{ $t('transactions.savedViews.revert') }}</Button>
  </div>

  <ResponsiveDialog v-model:open="isNameDialogOpen">
    <template #title>
      {{ $t(viewToRename ? 'transactions.savedViews.renameTitle' : 'transactions.savedViews.saveTitle') }}
    </template>
    <template #description>{{ $t('transactions.savedViews.dialogDescription') }}</template>

    <form @submit.prevent="submitName">
      <InputField
        v-model="viewName"
        :label="$t('transactions.savedViews.nameLabel')"
        :placeholder="$t('transactions.savedViews.namePlaceholder')"
        :maxlength="NAME_INPUT_MAX_LENGTH"
        autofocus
      />
    </form>

    <template #footer="{ close }">
      <Button variant="ghost" @click="close">{{ $t('common.actions.cancel') }}</Button>
      <Button :disabled="!viewName.trim() || isPatching" :loading="isPatching" @click="submitName">
        {{ $t('common.actions.save') }}
      </Button>
    </template>
  </ResponsiveDialog>

  <ResponsiveAlertDialog
    :open="!!viewToDelete"
    :confirm-label="$t('common.actions.delete')"
    confirm-variant="destructive"
    :confirm-disabled="isPatching"
    @update:open="(open) => !open && (viewToDelete = null)"
    @confirm="deleteView"
  >
    <template #title>{{ $t('transactions.savedViews.deleteTitle', { name: viewToDelete?.name }) }}</template>
    <template #description>{{ $t('transactions.savedViews.deleteDescription') }}</template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { loadTransactionsSummary } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { randomId } from '@/common/utils/random-id';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { DEFAULT_FILTERS, type FiltersStruct } from '@/components/records-filters/const';
import { FILTER_REGISTRY, type FilterKey } from '@/components/records-filters/filter-registry';
import {
  buildViewConfig,
  holdsPresetRange,
  resolveView,
  useActiveView,
} from '@/components/records-filters/saved-views';
import { buildFilterParams } from '@/components/records-filters/transactions-with-filters';
import { DEFAULT_SORTING, type TableSorting } from '@/components/transactions-table/columns';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { cn } from '@/lib/utils';
import { MAX_SAVED_TRANSACTION_VIEWS, type SavedTransactionView } from '@bt/shared/types';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from '@lucide/vue';
import { useQueries } from '@tanstack/vue-query';
import { isEqual } from 'lodash-es';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const COUNT_STALE_TIME_MS = 24 * 60 * 60 * 1_000;
// Tighter than the server's limit: the name has to fit the toolbar button and the popover row.
const NAME_INPUT_MAX_LENGTH = 24;

defineProps<{
  /** Trigger fills its flex row, with a "filters changed" strip wrapping below it, for the list view's sidebar. */
  block?: boolean;
  /** Idle trigger styled as a secondary button, to sit beside the mobile header's buttons. */
  secondaryTrigger?: boolean;
}>();

const emit = defineEmits<{ applied: [] }>();

const filters = defineModel<FiltersStruct>('filters', { required: true });
const sorting = defineModel<TableSorting>('sorting', { required: true });

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { data: settings, patchAsync, isPatching } = useUserSettings();

const isOpen = ref(false);
const views = computed<SavedTransactionView[]>(() => settings.value?.savedTransactionViews ?? []);
const resolvedViews = computed(() => views.value.map((view) => resolveView({ view })));

const active = useActiveView();
const activeView = computed(() => views.value.find((view) => view.id === active.value?.id));
const appliedOn = computed(() => (active.value ? new Date(active.value.appliedOn) : undefined));
const setActive = ({ id }: { id: string }) => {
  active.value = { id, appliedOn: new Date().toISOString() };
};
// `batchId` is never saved, so it must not make the page state differ from a view either.
const current = computed(() => ({ filters: { ...filters.value, batchId: null }, sorting: sorting.value }));
const isModified = computed(
  () => !!activeView.value && !isEqual(resolveView({ view: activeView.value, now: appliedOn.value }), current.value),
);

// Nothing to save without filters, and a second view with the same filters is only a duplicate.
const canSaveNew = computed(
  () =>
    views.value.length < MAX_SAVED_TRANSACTION_VIEWS &&
    !isEqual(current.value.filters, DEFAULT_FILTERS) &&
    !(activeView.value && !isModified.value) &&
    !resolvedViews.value.some((resolved) => isEqual(resolved, current.value)),
);

const presetLabels = computed(() => ({
  thisMonth: t('transactions.filters.dateRange.presets.thisMonth'),
  last3Months: t('transactions.filters.dateRange.presets.last3Months'),
  last6Months: t('transactions.filters.dateRange.presets.last6Months'),
  last12Months: t('transactions.filters.dateRange.presets.last12Months'),
}));

const summaries = computed(() =>
  views.value.map((view, index) => {
    // A preset range is named on its own, so it is not counted as a filter.
    const filtersCount = (Object.keys(FILTER_REGISTRY) as FilterKey[]).filter(
      (key) =>
        !(key === 'date' && view.datePreset) && FILTER_REGISTRY[key].isActive(resolvedViews.value[index]!.filters),
    ).length;

    return [
      view.datePreset && presetLabels.value[view.datePreset],
      filtersCount > 0 && t('transactions.savedViews.filtersCount', filtersCount),
    ]
      .filter(Boolean)
      .join(' · ');
  }),
);

const counts = useQueries({
  queries: computed(() =>
    resolvedViews.value.map((view) => {
      const params = buildFilterParams({ filter: view.filters });

      return {
        queryKey: [...VUE_QUERY_CACHE_KEYS.savedTransactionViewCount, params],
        queryFn: () => loadTransactionsSummary(params),
        staleTime: COUNT_STALE_TIME_MS,
        enabled: isOpen.value,
      };
    }),
  ),
});

const applyView = ({ view }: { view: SavedTransactionView }) => {
  const resolved = resolveView({ view });

  filters.value = resolved.filters;
  sorting.value = resolved.sorting;
  setActive({ id: view.id });
  isOpen.value = false;
  emit('applied');
};

const resetView = () => {
  filters.value = { ...DEFAULT_FILTERS };
  sorting.value = { ...DEFAULT_SORTING };
  active.value = null;
  isOpen.value = false;
  emit('applied');
};

const revert = () => {
  if (activeView.value) applyView({ view: activeView.value });
};

const saveViews = async ({ next, toast }: { next: SavedTransactionView[]; toast: string }) => {
  try {
    await patchAsync({ savedTransactionViews: next });
    addSuccessNotification(toast);
    return true;
  } catch {
    addErrorNotification(t('transactions.savedViews.saveError'));
    return false;
  }
};

const updateActiveView = async () => {
  const view = activeView.value;
  if (!view || !appliedOn.value) return;

  const config = buildViewConfig(current.value);
  const keepsRolling = holdsPresetRange({ view, filters: filters.value, appliedOn: appliedOn.value });
  const datePreset = config.datePreset ?? (keepsRolling ? view.datePreset : undefined);

  const saved = await saveViews({
    next: views.value.map((item) => (item.id === view.id ? { ...item, ...config, datePreset } : item)),
    toast: t('transactions.savedViews.updatedToast'),
  });
  // A range detected as a preset today is today's range, so the view now counts as applied today.
  if (saved && config.datePreset) setActive({ id: view.id });
};

const moveView = ({ index, offset }: { index: number; offset: number }) => {
  const next = [...views.value];
  [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];

  return saveViews({ next, toast: t('transactions.savedViews.updatedToast') });
};

const isNameDialogOpen = ref(false);
const viewToRename = ref<SavedTransactionView | null>(null);
const viewName = ref('');

const openNameDialog = ({ view = null }: { view?: SavedTransactionView | null }) => {
  viewToRename.value = view;
  viewName.value = view?.name ?? '';
  isOpen.value = false;
  isNameDialogOpen.value = true;
};

const submitName = async () => {
  const name = viewName.value.trim();
  if (!name || isPatching.value) return;

  const renamed = viewToRename.value;
  if (renamed) {
    const saved = await saveViews({
      next: views.value.map((view) => (view.id === renamed.id ? { ...view, name } : view)),
      toast: t('transactions.savedViews.updatedToast'),
    });
    if (!saved) return;
  } else {
    const created: SavedTransactionView = { id: randomId(), name, ...buildViewConfig(current.value) };
    const saved = await saveViews({ next: [...views.value, created], toast: t('transactions.savedViews.savedToast') });
    if (!saved) return;
    setActive({ id: created.id });
  }

  isNameDialogOpen.value = false;
};

const viewToDelete = ref<SavedTransactionView | null>(null);

const openDeleteDialog = ({ view }: { view: SavedTransactionView }) => {
  isOpen.value = false;
  viewToDelete.value = view;
};

const deleteView = async () => {
  const id = viewToDelete.value?.id;
  if (!id || isPatching.value) return;
  viewToDelete.value = null;

  await saveViews({
    next: views.value.filter((view) => view.id !== id),
    toast: t('transactions.savedViews.deletedToast'),
  });
};
</script>
