<script setup lang="ts">
import { deleteWatchlistItem, deleteWatchlistSection, updateWatchlistItem } from '@/api/watchlist';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import AddHoldingTransactionDialog from '@/components/holdings/add-holding-transaction-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { type RecordId, WATCHLIST_LIMITS, type WatchlistItemModel, type WatchlistSectionModel } from '@bt/shared/types';
import type { PortfolioModel } from '@bt/shared/types/investments';
import {
  AlertCircleIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClockIcon,
  EllipsisIcon,
  EyeIcon,
  FolderPlusIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

import AddWatchlistItemDialog from './add-watchlist-item-dialog.vue';
import EditWatchlistItemDialog from './edit-watchlist-item-dialog.vue';
import ManageWatchlistLayoutDialog from './manage-watchlist-layout-dialog.vue';
import { useWatchlist, useWatchlistMutation } from './use-watchlist';
import { useWatchlistBuy } from './use-watchlist-buy';
import WatchlistAlertsDialog from './watchlist-alerts-dialog.vue';
import { distanceToTargetPercent } from './watchlist-helpers';
import WatchlistRow from './watchlist-row.vue';
import WatchlistSectionDialog from './watchlist-section-dialog.vue';

const COLUMN_COUNT = 7;

const props = defineProps<{ portfolioId: string; portfolio: PortfolioModel }>();
const portfolioId = toRef(props, 'portfolioId');

const { t } = useI18n();
const { data: watchlist, isLoading, isError, refetch } = useWatchlist({ portfolioId });

const filterText = ref('');
const filterTerm = computed(() => filterText.value.trim().toLowerCase());
const matches = (item: WatchlistItemModel) =>
  !filterTerm.value ||
  [item.security.symbol, item.security.name].some((value) => value?.toLowerCase().includes(filterTerm.value));

const ungroupedItems = computed(() => (watchlist.value?.ungroupedItems ?? []).filter(matches));
const visibleSections = computed(() =>
  (watchlist.value?.sections ?? [])
    .map((section) => ({ ...section, visibleItems: section.items.filter(matches) }))
    .filter((section) => !filterTerm.value || section.visibleItems.length),
);
const sectionOptions = computed(() => watchlist.value?.sections ?? []);
const allItems = computed(() =>
  watchlist.value
    ? [...watchlist.value.ungroupedItems, ...watchlist.value.sections.flatMap((section) => section.items)]
    : [],
);
const totalItems = computed(() => allItems.value.length);
const isAtItemLimit = computed(() => totalItems.value >= WATCHLIST_LIMITS.maxItems);
const isAtSectionLimit = computed(() => sectionOptions.value.length >= WATCHLIST_LIMITS.maxSections);
const isEmpty = computed(() => !!watchlist.value && !totalItems.value && !watchlist.value.sections.length);
const hasNoMatches = computed(
  () => !!filterTerm.value && !ungroupedItems.value.length && !visibleSections.value.length,
);

const collapsedIds = ref(new Set<string>());
const isCollapsed = (sectionId: string) => !filterTerm.value && collapsedIds.value.has(sectionId);
const toggleSection = (sectionId: string) => {
  const next = new Set(collapsedIds.value);
  if (next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  collapsedIds.value = next;
};
const allCollapsed = computed(
  () => !!sectionOptions.value.length && sectionOptions.value.every((section) => collapsedIds.value.has(section.id)),
);
const toggleAll = () => {
  collapsedIds.value = allCollapsed.value ? new Set() : new Set(sectionOptions.value.map((section) => section.id));
};

const sectionSummary = (section: WatchlistSectionModel) => {
  const inBuyZone = section.items.filter((item) => {
    const distance = distanceToTargetPercent({ item });
    return distance !== null && distance <= 0;
  }).length;
  const activeAlerts = section.items.reduce(
    (sum, item) => sum + item.alerts.filter((alert) => alert.isActive).length,
    0,
  );
  return [
    inBuyZone && t('portfolioDetail.watchlist.sectionSummary.inBuyZone', { count: inBuyZone }),
    activeAlerts && t('portfolioDetail.watchlist.sectionSummary.alerts', { count: activeAlerts }),
  ]
    .filter(Boolean)
    .join(' · ');
};

const isAddOpen = ref(false);
const isLayoutOpen = ref(false);
const isSectionDialogOpen = ref(false);
const sectionToRename = ref<Pick<WatchlistSectionModel, 'id' | 'name'> | null>(null);
const openNewSection = () => {
  sectionToRename.value = null;
  isSectionDialogOpen.value = true;
};
const openRenameSection = (section: WatchlistSectionModel) => {
  sectionToRename.value = { id: section.id, name: section.name };
  isSectionDialogOpen.value = true;
};

const sectionToDelete = ref<WatchlistSectionModel | null>(null);
const isDeleteSectionOpen = ref(false);
const askDeleteSection = (section: WatchlistSectionModel) => {
  sectionToDelete.value = section;
  isDeleteSectionOpen.value = true;
};
const deleteSectionMutation = useWatchlistMutation({
  mutationFn: deleteWatchlistSection,
  successKey: 'portfolioDetail.watchlist.sections.deleted',
  errorKey: 'portfolioDetail.watchlist.sections.deleteError',
  onSuccess: () => {
    isDeleteSectionOpen.value = false;
  },
});
const confirmDeleteSection = () => {
  if (!sectionToDelete.value) return;
  deleteSectionMutation.mutate({ portfolioId: props.portfolioId, sectionId: sectionToDelete.value.id });
};

const findItem = (itemId: string | null) => allItems.value.find((item) => item.id === itemId) ?? null;

const alertsItemId = ref<string | null>(null);
const alertsItem = computed(() => findItem(alertsItemId.value));
const isAlertsOpen = ref(false);
const openAlerts = (item: WatchlistItemModel) => {
  alertsItemId.value = item.id;
  isAlertsOpen.value = true;
};

const editItem = ref<WatchlistItemModel | null>(null);
const isEditOpen = ref(false);
const openEdit = (item: WatchlistItemModel) => {
  editItem.value = item;
  isEditOpen.value = true;
};

const moveMutation = useWatchlistMutation({
  mutationFn: updateWatchlistItem,
  errorKey: 'portfolioDetail.watchlist.items.saveError',
});
const moveItem = ({ item, sectionId }: { item: WatchlistItemModel; sectionId: RecordId | null }) => {
  if (item.sectionId === sectionId) return;
  moveMutation.mutate({ portfolioId: props.portfolioId, itemId: item.id, sectionId });
};

const itemToRemove = ref<WatchlistItemModel | null>(null);
const isRemoveOpen = ref(false);
const askRemove = (item: WatchlistItemModel) => {
  itemToRemove.value = item;
  isRemoveOpen.value = true;
};
const removeMutation = useWatchlistMutation({
  mutationFn: deleteWatchlistItem,
  successKey: 'portfolioDetail.watchlist.items.removed',
  errorKey: 'portfolioDetail.watchlist.items.removeError',
  onSuccess: () => {
    isRemoveOpen.value = false;
  },
});
const confirmRemove = () => {
  if (!itemToRemove.value) return;
  removeMutation.mutate({ portfolioId: props.portfolioId, itemId: itemToRemove.value.id });
};

const { buyHolding, isBuyOpen, canBuy, openBuy } = useWatchlistBuy({ portfolioId });
</script>

<template>
  <div class="@container/watchlist grid gap-4">
    <div class="flex flex-col gap-3 @2xl/watchlist:flex-row @2xl/watchlist:items-center @2xl/watchlist:justify-between">
      <InputField
        v-model="filterText"
        size="sm"
        class="w-full @2xl/watchlist:max-w-80"
        :placeholder="$t('portfolioDetail.watchlist.filterPlaceholder')"
      >
        <template #iconLeading>
          <SearchIcon class="text-muted-foreground size-4" />
        </template>
        <template v-if="filterText" #iconTrailing>
          <DesktopOnlyTooltip :content="$t('common.actions.clear')">
            <Button variant="ghost" size="icon-sm" :aria-label="$t('common.actions.clear')" @click="filterText = ''">
              <XIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </template>
      </InputField>

      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="sectionOptions.length && !filterTerm" size="sm" variant="outline" @click="toggleAll">
          <ChevronsUpDownIcon v-if="allCollapsed" class="size-4" />
          <ChevronsDownUpIcon v-else class="size-4" />
          {{ allCollapsed ? $t('portfolioDetail.watchlist.expandAll') : $t('portfolioDetail.watchlist.collapseAll') }}
        </Button>
        <Button v-if="watchlist && totalItems" size="sm" variant="outline" @click="isLayoutOpen = true">
          <GripVerticalIcon class="size-4" />
          {{ $t('portfolioDetail.watchlist.layout.open') }}
        </Button>
        <DesktopOnlyTooltip
          :content="$t('portfolioDetail.watchlist.limits.sections', { max: WATCHLIST_LIMITS.maxSections })"
          :disabled="!isAtSectionLimit"
        >
          <span class="inline-flex">
            <Button size="sm" variant="outline" :disabled="!watchlist || isAtSectionLimit" @click="openNewSection">
              <FolderPlusIcon class="size-4" />
              {{ $t('portfolioDetail.watchlist.sections.new') }}
            </Button>
          </span>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip
          :content="$t('portfolioDetail.watchlist.limits.items', { max: WATCHLIST_LIMITS.maxItems })"
          :disabled="!isAtItemLimit"
        >
          <span class="inline-flex">
            <Button size="sm" :disabled="!watchlist || isAtItemLimit" @click="isAddOpen = true">
              <PlusIcon class="size-4" />
              {{ $t('portfolioDetail.watchlist.add.open') }}
            </Button>
          </span>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <Callout v-if="isError && watchlist" variant="destructive" role="alert">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{{ $t('portfolioDetail.watchlist.refreshError') }}</span>
        <Button variant="outline" size="xs" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
      </div>
    </Callout>

    <Card class="min-w-0 overflow-hidden">
      <div v-if="isLoading" class="grid gap-1 p-4">
        <div v-for="i in 5" :key="i" class="flex items-center gap-4 py-2">
          <div class="bg-muted size-8 animate-pulse rounded-full" />
          <div class="grid gap-1">
            <div class="bg-muted h-4 w-16 animate-pulse rounded" />
            <div class="bg-muted h-3 w-32 animate-pulse rounded opacity-60" />
          </div>
          <div class="bg-muted ml-auto h-4 w-20 animate-pulse rounded" />
          <div class="bg-muted h-4 w-14 animate-pulse rounded" />
          <div class="bg-muted h-4 w-24 animate-pulse rounded" />
        </div>
      </div>

      <div v-else-if="isError && !watchlist" class="flex flex-col items-center py-12 text-center">
        <div class="bg-destructive/10 mb-3 flex size-12 items-center justify-center rounded-full">
          <AlertCircleIcon class="text-destructive-text size-6" />
        </div>
        <p class="text-destructive-text mb-3 font-medium">{{ $t('portfolioDetail.watchlist.loadError') }}</p>
        <Button variant="outline" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
      </div>

      <div v-else-if="isEmpty" class="flex flex-col items-center px-4 py-12 text-center">
        <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
          <EyeIcon class="text-muted-foreground size-6" />
        </div>
        <h3 class="mb-2 text-lg font-semibold">{{ $t('portfolioDetail.watchlist.empty.title') }}</h3>
        <p class="text-muted-foreground mb-4 max-w-md text-sm">
          {{ $t('portfolioDetail.watchlist.empty.description') }}
        </p>
        <Button @click="isAddOpen = true">
          <PlusIcon class="size-4" />
          {{ $t('portfolioDetail.watchlist.add.open') }}
        </Button>
      </div>

      <div v-else-if="hasNoMatches" class="text-muted-foreground px-4 py-12 text-center text-sm">
        {{ $t('portfolioDetail.watchlist.noMatches') }}
      </div>

      <template v-else-if="watchlist">
        <ScrollArea viewport-class="overscroll-x-none" with-horizontal-scrollbar>
          <div class="pb-2.5">
            <table class="w-full min-w-240">
              <thead class="text-muted-foreground bg-table-header">
                <tr class="text-xs font-medium tracking-wider uppercase">
                  <th class="px-3 py-2 text-left">{{ $t('portfolioDetail.watchlist.columns.security') }}</th>
                  <th class="px-3 py-2 text-right">{{ $t('portfolioDetail.watchlist.columns.lastClose') }}</th>
                  <th class="px-3 py-2 text-right">{{ $t('portfolioDetail.watchlist.columns.dailyChange') }}</th>
                  <th class="px-3 py-2 text-left">{{ $t('portfolioDetail.watchlist.columns.range52w') }}</th>
                  <th class="px-3 py-2 text-right">{{ $t('portfolioDetail.watchlist.columns.buyBelow') }}</th>
                  <th class="px-3 py-2 text-left">{{ $t('portfolioDetail.watchlist.columns.note') }}</th>
                  <th class="px-3 py-2">
                    <span class="sr-only">{{ $t('portfolioDetail.watchlist.columns.actions') }}</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                <WatchlistRow
                  v-for="item in ungroupedItems"
                  :key="item.id"
                  :item="item"
                  :portfolio-id="portfolioId"
                  :sections="sectionOptions"
                  :buy-disabled="!canBuy"
                  :indented="false"
                  @alerts="openAlerts(item)"
                  @buy="openBuy({ item })"
                  @edit="openEdit(item)"
                  @remove="askRemove(item)"
                  @move="(sectionId) => moveItem({ item, sectionId })"
                />
              </tbody>

              <tbody v-for="section in visibleSections" :key="section.id">
                <tr class="bg-table-header border-border border-t">
                  <td :colspan="COLUMN_COUNT" class="py-1 pr-3 pl-1">
                    <div class="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        class="min-w-0 justify-start gap-2 px-2 font-semibold hover:bg-transparent"
                        :aria-expanded="!isCollapsed(section.id)"
                        @click="toggleSection(section.id)"
                      >
                        <ChevronRightIcon
                          :class="
                            cn(
                              'text-muted-foreground size-4 shrink-0 transition-transform',
                              !isCollapsed(section.id) && 'rotate-90',
                            )
                          "
                        />
                        <span class="truncate">{{ section.name }}</span>
                        <span class="text-muted-foreground tabular-nums">{{ section.items.length }}</span>
                      </Button>
                      <span class="text-muted-foreground truncate text-xs">{{ sectionSummary(section) }}</span>

                      <DropdownMenu>
                        <DropdownMenuTrigger as-child>
                          <span class="ml-auto inline-flex">
                            <DesktopOnlyTooltip :content="$t('common.actions.more')">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                :aria-label="$t('portfolioDetail.watchlist.sections.menuFor', { name: section.name })"
                              >
                                <EllipsisIcon class="size-4" />
                              </Button>
                            </DesktopOnlyTooltip>
                          </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem @click="openRenameSection(section)">
                            <PencilIcon class="size-4" />
                            {{ $t('portfolioDetail.watchlist.sections.rename') }}
                          </DropdownMenuItem>
                          <DropdownMenuItem class="text-destructive-text" @click="askDeleteSection(section)">
                            <Trash2Icon class="size-4" />
                            {{ $t('portfolioDetail.watchlist.sections.delete') }}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>

                <template v-if="!isCollapsed(section.id)">
                  <WatchlistRow
                    v-for="item in section.visibleItems"
                    :key="item.id"
                    :item="item"
                    :portfolio-id="portfolioId"
                    :sections="sectionOptions"
                    :buy-disabled="!canBuy"
                    indented
                    @alerts="openAlerts(item)"
                    @buy="openBuy({ item })"
                    @edit="openEdit(item)"
                    @remove="askRemove(item)"
                    @move="(sectionId) => moveItem({ item, sectionId })"
                  />
                  <tr v-if="!section.items.length" class="border-border border-t">
                    <td :colspan="COLUMN_COUNT" class="text-muted-foreground py-3 pr-3 pl-10 text-sm">
                      {{ $t('portfolioDetail.watchlist.sections.empty') }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </ScrollArea>

        <p class="text-muted-foreground border-border flex items-center gap-2 border-t px-4 py-3 text-sm">
          <ClockIcon class="size-3.5 shrink-0" />
          {{ $t('portfolioDetail.watchlist.pricesFootnote') }}
        </p>
      </template>
    </Card>

    <AddWatchlistItemDialog v-model:open="isAddOpen" :portfolio-id="portfolioId" :sections="sectionOptions" />
    <WatchlistSectionDialog v-model:open="isSectionDialogOpen" :portfolio-id="portfolioId" :section="sectionToRename" />
    <ManageWatchlistLayoutDialog
      v-if="watchlist"
      v-model:open="isLayoutOpen"
      :portfolio-id="portfolioId"
      :watchlist="watchlist"
    />
    <EditWatchlistItemDialog v-model:open="isEditOpen" :portfolio-id="portfolioId" :item="editItem" />
    <WatchlistAlertsDialog v-model:open="isAlertsOpen" :portfolio-id="portfolioId" :item="alertsItem" />
    <AddHoldingTransactionDialog
      v-model:open="isBuyOpen"
      :portfolio-id="portfolioId"
      :holding="buyHolding"
      :portfolio-name="portfolio.name"
    />

    <ResponsiveAlertDialog
      v-model:open="isDeleteSectionOpen"
      :confirm-label="$t('common.actions.delete')"
      confirm-variant="destructive"
      :confirm-disabled="deleteSectionMutation.isPending.value"
      @confirm="confirmDeleteSection"
    >
      <template #title>
        {{ $t('portfolioDetail.watchlist.sections.deleteTitle', { name: sectionToDelete?.name ?? '' }) }}
      </template>
      <template #description>{{ $t('portfolioDetail.watchlist.sections.deleteDescription') }}</template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="isRemoveOpen"
      :confirm-label="$t('portfolioDetail.watchlist.items.remove')"
      confirm-variant="destructive"
      :confirm-disabled="removeMutation.isPending.value"
      @confirm="confirmRemove"
    >
      <template #title>
        {{ $t('portfolioDetail.watchlist.items.removeTitle', { symbol: itemToRemove?.security.symbol ?? '' }) }}
      </template>
      <template #description>{{ $t('portfolioDetail.watchlist.items.removeDescription') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
