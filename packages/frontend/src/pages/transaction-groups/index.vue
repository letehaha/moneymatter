<script setup lang="ts">
import * as transactionGroupsApi from '@/api/transaction-groups';
import type { TransactionGroupResponse } from '@/api/transaction-groups';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { invalidateTransactionGroupQueries } from '@/composable/data-queries/transaction-groups';
import { useFormatCurrency } from '@/composable/formatters';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage } from '@/js/errors';
import { cn } from '@/lib/utils';
import { useQueryClient, useQuery } from '@tanstack/vue-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  EllipsisIcon,
  GroupIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { computed, reactive, ref } from 'vue';
import { format, parseISO } from 'date-fns';

import EditGroupDialog from './edit-group-dialog.vue';
import { DEFAULT_SORT_DIRECTION, type GroupSortDirection, type GroupSortField, sortGroups } from './sort-groups';
import TransactionGroupDialog from './transaction-group-dialog.vue';
import { useI18n } from 'vue-i18n';

const SKELETON_ROW_COUNT = 5;
const ROW_GRID =
  'grid min-h-10 grid-cols-[minmax(0,1fr)_auto_36px] items-center gap-2 py-2 pr-1 pl-3 @2xl/groups:grid-cols-[minmax(0,1fr)_7rem_11.5rem_7.5rem_28px] @2xl/groups:gap-4 @2xl/groups:py-1.5 @2xl/groups:pr-2 @2xl/groups:pl-4';

const { t } = useI18n();
const queryClient = useQueryClient();
const { addErrorNotification } = useNotificationCenter();
const { formatBaseCurrency } = useFormatCurrency();

const { data, isPending, isError, refetch } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.transactionGroupsList,
  queryFn: () => transactionGroupsApi.loadTransactionGroups(),
});
const groups = computed(() => data.value ?? []);

const searchQuery = ref('');

const filteredGroups = computed(() => {
  if (!searchQuery.value) return groups.value;
  const query = searchQuery.value.toLowerCase();
  return groups.value.filter((g) => g.name.toLowerCase().includes(query) || g.note?.toLowerCase().includes(query));
});

const sortState = reactive<{ field: GroupSortField; direction: GroupSortDirection }>({
  field: 'date',
  direction: DEFAULT_SORT_DIRECTION.date,
});

const visibleGroups = computed(() =>
  sortGroups({
    groups: filteredGroups.value,
    field: sortState.field,
    direction: sortState.direction,
  }),
);

const toggleSort = ({ field }: { field: GroupSortField }) => {
  if (sortState.field === field) {
    sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.field = field;
    sortState.direction = DEFAULT_SORT_DIRECTION[field];
  }
};

const sortIcon = ({ field }: { field: GroupSortField }) => {
  if (sortState.field !== field) return ChevronsUpDownIcon;
  return sortState.direction === 'asc' ? ArrowUpIcon : ArrowDownIcon;
};

const sortOptions = computed(() =>
  (
    [
      ['date', 'desc', 'transactions.transactionGroups.groupsPage.sort.dateDesc'],
      ['date', 'asc', 'transactions.transactionGroups.groupsPage.sort.dateAsc'],
      ['name', 'asc', 'transactions.transactionGroups.groupsPage.sort.nameAsc'],
      ['name', 'desc', 'transactions.transactionGroups.groupsPage.sort.nameDesc'],
      ['amount', 'desc', 'transactions.transactionGroups.groupsPage.sort.amountDesc'],
      ['amount', 'asc', 'transactions.transactionGroups.groupsPage.sort.amountAsc'],
    ] as const
  ).map(([field, direction, labelKey]) => ({
    value: `${field}-${direction}`,
    label: t(labelKey),
    field,
    direction,
  })),
);

const selectedSortOption = computed(
  () => sortOptions.value.find((o) => o.field === sortState.field && o.direction === sortState.direction) ?? null,
);

const setSort = (option: { field: GroupSortField; direction: GroupSortDirection } | null) => {
  if (!option) return;
  sortState.field = option.field;
  sortState.direction = option.direction;
};

const [DefineSortButton, SortButton] = createReusableTemplate<{
  field: GroupSortField;
  label: string;
  align: 'start' | 'end';
}>();

const invalidateGroups = () => invalidateTransactionGroupQueries({ queryClient });

// Dialog state
const dialogState = reactive({
  isOpen: false,
  key: 0,
  groupId: undefined as string | undefined,
});

const openGroupDialog = ({ groupId }: { groupId: string }) => {
  dialogState.groupId = groupId;
  dialogState.key++;
  dialogState.isOpen = true;
};

const editState = reactive({
  isOpen: false,
  group: null as TransactionGroupResponse | null,
});

const openEdit = ({ group }: { group: TransactionGroupResponse }) => {
  editState.group = group;
  editState.isOpen = true;
};

// Delete confirmation
const deleteState = reactive({
  isOpen: false,
  groupId: undefined as string | undefined,
  groupName: '',
});

const confirmDelete = ({ group }: { group: TransactionGroupResponse }) => {
  deleteState.groupId = group.id;
  deleteState.groupName = group.name;
  deleteState.isOpen = true;
};

const handleDelete = async () => {
  if (!deleteState.groupId) return;
  try {
    await transactionGroupsApi.deleteTransactionGroup({
      id: deleteState.groupId,
    });
  } catch (error) {
    addErrorNotification(extractApiErrorMessage(error) || t('transactions.transactionGroups.groupsPage.deleteError'));
  } finally {
    deleteState.isOpen = false;
    invalidateGroups();
  }
};

const formatDateRange = ({ group }: { group: TransactionGroupResponse }) => {
  if (!group.dateFrom && !group.dateTo) return '';
  const from = group.dateFrom ? format(parseISO(group.dateFrom), 'd MMM yyyy') : '';
  const to = group.dateTo ? format(parseISO(group.dateTo), 'd MMM yyyy') : '';
  if (from === to) return from;
  return `${from} – ${to}`;
};

const formatPhoneCaption = ({ group }: { group: TransactionGroupResponse }) =>
  [formatDateRange({ group }), group.note].filter(Boolean).join(' · ');
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4 p-4 md:px-6">
    <div class="min-w-0">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ $t('transactions.transactionGroups.groupsPage.title') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">
        {{ $t('transactions.transactionGroups.groupsPage.description') }}
      </p>
    </div>

    <Card class="@container/groups overflow-hidden rounded-xl">
      <div class="divide-border divide-y">
        <div class="flex items-center gap-2 px-3 py-2.5 @2xl/groups:px-4">
          <div class="min-w-0 flex-1">
            <InputField
              v-model="searchQuery"
              type="search"
              :placeholder="$t('transactions.transactionGroups.groupsPage.searchPlaceholder')"
              :aria-label="$t('transactions.transactionGroups.groupsPage.searchPlaceholder')"
            >
              <template #iconLeading>
                <SearchIcon class="text-muted-foreground size-4" />
              </template>
            </InputField>
          </div>
          <SelectField
            v-if="groups.length"
            class="w-auto min-w-36 shrink-0 @2xl/groups:hidden"
            :model-value="selectedSortOption"
            :values="sortOptions"
            :placeholder="$t('transactions.transactionGroups.groupsPage.sort.label')"
            :aria-label="$t('transactions.transactionGroups.groupsPage.sort.label')"
            @update:model-value="setSort"
          />
        </div>

        <DefineSortButton v-slot="{ field, label, align }">
          <Button
            variant="ghost"
            size="sm"
            :class="
              cn(
                'text-muted-foreground hover:text-foreground -mx-1.5 h-7 gap-1 px-1.5 text-xs font-medium',
                align === 'end' ? 'justify-self-end' : 'justify-self-start',
                sortState.field === field && 'text-foreground',
              )
            "
            @click="toggleSort({ field })"
          >
            {{ label }}
            <component :is="sortIcon({ field })" class="size-3.5" />
          </Button>
        </DefineSortButton>

        <div
          v-if="!isPending && filteredGroups.length"
          :class="cn(ROW_GRID, 'text-muted-foreground hidden min-h-0 text-xs @2xl/groups:grid @2xl/groups:py-1')"
        >
          <SortButton
            field="name"
            :label="$t('transactions.transactionGroups.groupsPage.columns.name')"
            align="start"
          />
          <span class="text-right font-medium">{{
            $t('transactions.transactionGroups.groupsPage.columns.transactions')
          }}</span>
          <SortButton
            field="date"
            :label="$t('transactions.transactionGroups.groupsPage.columns.date')"
            align="start"
          />
          <SortButton field="amount" :label="$t('transactions.transactionGroups.groupsPage.columns.net')" align="end" />
          <span />
        </div>

        <template v-if="isPending">
          <div v-for="i in SKELETON_ROW_COUNT" :key="i" :class="cn(ROW_GRID, 'animate-pulse')" aria-hidden="true">
            <div class="grid gap-1.5">
              <div class="bg-muted h-4 w-2/5 rounded" />
              <div class="bg-muted h-3 w-1/3 rounded @2xl/groups:hidden" />
            </div>
            <div class="bg-muted ml-auto hidden h-3.5 w-24 rounded @2xl/groups:block" />
            <div class="bg-muted hidden h-3.5 w-36 rounded @2xl/groups:block" />
            <div class="grid justify-items-end gap-1.5">
              <div class="bg-muted h-4 w-20 rounded" />
              <div class="bg-muted h-3 w-16 rounded @2xl/groups:hidden" />
            </div>
            <div class="bg-muted mx-auto size-4 rounded" />
          </div>
        </template>

        <ErrorState
          v-else-if="isError"
          :message="$t('transactions.transactionGroups.groupsPage.loadError')"
          @retry="refetch()"
        />

        <div v-else-if="!groups.length" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
          <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
            <GroupIcon class="size-5" />
          </div>
          <p class="text-sm font-semibold">
            {{ $t('transactions.transactionGroups.groupsPage.noGroupsMessage') }}
          </p>
          <p class="text-muted-foreground max-w-[42ch] text-sm leading-relaxed">
            {{ $t('transactions.transactionGroups.groupsPage.emptyStateHint') }}
          </p>
        </div>

        <div v-else-if="!filteredGroups.length" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
          <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
            <SearchIcon class="size-5" />
          </div>
          <p class="text-sm font-semibold">
            {{ $t('transactions.transactionGroups.groupsPage.noMatchTitle') }}
          </p>
        </div>

        <template v-else>
          <div
            v-for="group in visibleGroups"
            :key="group.id"
            :class="
              cn(
                ROW_GRID,
                'hover:bg-foreground/5 has-[button:focus-visible]:bg-foreground/5 relative transition-colors',
              )
            "
          >
            <div class="min-w-0">
              <div class="flex min-w-0 items-baseline gap-2">
                <Button
                  variant="link"
                  class="text-foreground h-auto min-w-[min(50%,max-content)] shrink justify-start p-0 text-base font-medium after:absolute after:inset-0 hover:no-underline"
                  @click="openGroupDialog({ groupId: group.id })"
                >
                  <span class="truncate">{{ group.name }}</span>
                </Button>
                <span
                  v-if="group.note"
                  class="text-muted-foreground hidden min-w-0 truncate text-xs @2xl/groups:inline"
                >
                  {{ group.note }}
                </span>
              </div>
              <div class="text-muted-foreground mt-0.5 truncate text-xs @2xl/groups:hidden">
                {{ formatPhoneCaption({ group }) }}
              </div>
            </div>

            <div
              class="text-muted-foreground hidden text-right text-sm whitespace-nowrap tabular-nums @2xl/groups:block"
            >
              {{ group.transactionCount }}
              {{ $t('transactions.transactionGroups.groupsPage.transactionCountLabel') }}
            </div>

            <div class="text-muted-foreground hidden text-sm whitespace-nowrap tabular-nums @2xl/groups:block">
              {{ formatDateRange({ group }) }}
            </div>

            <div class="text-right whitespace-nowrap tabular-nums">
              <div
                v-if="group.netRefAmount !== undefined"
                :class="
                  cn(
                    'text-sm font-medium',
                    group.netRefAmount >= 0 ? 'text-app-income-color' : 'text-app-expense-color',
                  )
                "
              >
                {{ formatBaseCurrency(group.netRefAmount) }}
              </div>
              <div class="text-muted-foreground text-xs @2xl/groups:hidden">
                {{ group.transactionCount }}
                {{ $t('transactions.transactionGroups.groupsPage.transactionCountLabel') }}
              </div>
            </div>

            <div class="relative z-10 flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground size-9 @2xl/groups:size-7"
                    :aria-label="$t('transactions.transactionGroups.groupsPage.moreActions', { name: group.name })"
                  >
                    <EllipsisIcon class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="min-w-44">
                  <DropdownMenuItem @select="openEdit({ group })">
                    <PencilIcon class="size-4" />
                    {{ $t('transactionGroups.groupDialog.editAction') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-destructive-text hover:bg-destructive-text/10 focus:bg-destructive-text/10 focus:text-destructive-text"
                    @select="confirmDelete({ group })"
                  >
                    <Trash2Icon class="size-4" />
                    {{ $t('transactionGroups.groupDialog.deleteAction') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </template>
      </div>
    </Card>

    <TransactionGroupDialog
      v-model:open="dialogState.isOpen"
      :key="dialogState.key"
      :group-id="dialogState.groupId"
      @deleted="invalidateGroups"
      @updated="invalidateGroups"
    />

    <EditGroupDialog v-model:open="editState.isOpen" :group="editState.group" @saved="invalidateGroups" />

    <ResponsiveAlertDialog
      v-model:open="deleteState.isOpen"
      confirm-label="Delete"
      confirm-variant="destructive"
      @confirm="handleDelete"
    >
      <template #title>{{ $t('transactionGroups.groupDialog.deleteGroupTitle') }}</template>
      <template #description>
        {{ $t('transactionGroups.groupDialog.deleteGroupDescription', { groupName: deleteState.groupName }) }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
