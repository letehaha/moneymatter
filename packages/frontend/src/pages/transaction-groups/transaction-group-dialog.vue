<script setup lang="ts">
import * as transactionGroupsApi from '@/api/transaction-groups';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { invalidateTransactionGroupQueries } from '@/composable/data-queries/transaction-groups';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { format, getTime } from 'date-fns';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { CheckIcon, EllipsisIcon, PencilIcon, Trash2Icon, XIcon } from '@lucide/vue';
import { useResizeObserver } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormatCurrency } from '@/composable/formatters';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage } from '@/js/errors';
import { cn } from '@/lib/utils';
import EditGroupDialog from './edit-group-dialog.vue';

const SUMMARY_CELL =
  'flex items-baseline justify-between gap-3 px-3 py-2 @md/summary:grid @md/summary:justify-start @md/summary:gap-0.5 @md/summary:px-4 @md/summary:py-2.5';
const SUMMARY_LABEL = 'text-muted-foreground text-sm @md/summary:text-xs';
const SUMMARY_VALUE = 'text-sm font-semibold whitespace-nowrap tabular-nums @md/summary:text-lg';

const { t } = useI18n();
const { formatCompactBaseCurrency } = useFormatCurrency();
const { addErrorNotification } = useNotificationCenter();

const props = defineProps<{
  open?: boolean;
  groupId?: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  deleted: [];
  updated: [];
}>();

const queryClient = useQueryClient();

const { data: group, isLoading } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.transactionGroupDetail, computed(() => props.groupId)],
  queryFn: () => (props.groupId ? transactionGroupsApi.loadTransactionGroupById({ id: props.groupId }) : null),
  enabled: computed(() => !!props.groupId && props.open),
});

const invalidateAll = () => invalidateTransactionGroupQueries({ queryClient });

// Edit dialog
const isEditDialogOpen = ref(false);

const startEdit = () => {
  isEditDialogOpen.value = true;
};

const handleEditSaved = () => {
  invalidateAll();
  emit('updated');
};

// Delete group
const isDeleteConfirmOpen = ref(false);

const openDeleteConfirm = () => {
  isDeleteConfirmOpen.value = true;
};

const handleDelete = async () => {
  if (!props.groupId) return;
  try {
    await transactionGroupsApi.deleteTransactionGroup({ id: props.groupId });
  } catch (error) {
    addErrorNotification(extractApiErrorMessage(error) || t('transactions.transactionGroups.groupsPage.deleteError'));
    return;
  } finally {
    isDeleteConfirmOpen.value = false;
  }
  emit('update:open', false);
  invalidateAll();
  emit('deleted');
};

// Remove transaction from group
const removeConfirm = reactive({
  isOpen: false,
  transactionId: undefined as string | undefined,
});

const wouldDissolve = computed(() => transactions.value.length <= 2);

const handleRemoveTransaction = ({ transactionId }: { transactionId: string }) => {
  removeConfirm.transactionId = transactionId;
  removeConfirm.isOpen = true;
};

const confirmRemoveTransaction = async () => {
  if (!props.groupId || !removeConfirm.transactionId) return;

  let result: Awaited<ReturnType<typeof transactionGroupsApi.removeTransactionsFromGroup>>;
  try {
    result = await transactionGroupsApi.removeTransactionsFromGroup({
      groupId: props.groupId,
      transactionIds: [removeConfirm.transactionId],
      force: wouldDissolve.value || undefined,
    });
  } catch (error) {
    addErrorNotification(extractApiErrorMessage(error) || t('transactionGroups.groupDialog.removeError'));
    return;
  } finally {
    removeConfirm.isOpen = false;
  }

  if (result.dissolved) {
    emit('update:open', false);
    emit('deleted');
  }

  invalidateAll();
};

const dateBounds = computed(() => {
  if (!group.value?.transactions?.length) return null;
  const times = group.value.transactions.map((tx) => getTime(tx.time));
  return { from: format(Math.min(...times), 'd MMM yyyy'), to: format(Math.max(...times), 'd MMM yyyy') };
});
const isSingleDay = computed(() => dateBounds.value?.from === dateBounds.value?.to);
const dateRange = computed(() => {
  if (!dateBounds.value) return '';
  return isSingleDay.value ? dateBounds.value.from : `${dateBounds.value.from} – ${dateBounds.value.to}`;
});

const isManaging = ref(false);

const noteEl = ref<HTMLElement | null>(null);
const isNoteExpanded = ref(false);
const isNoteClamped = ref(false);
useResizeObserver(noteEl, () => {
  if (noteEl.value && !isNoteExpanded.value)
    isNoteClamped.value = noteEl.value.scrollHeight > noteEl.value.clientHeight;
});

watch(
  () => [props.open, props.groupId],
  () => {
    isManaging.value = false;
    isNoteExpanded.value = false;
  },
);

const transactions = computed(() => group.value?.transactions ?? []);

const metaLine = computed(() =>
  [
    dateRange.value,
    transactions.value.length
      ? `${transactions.value.length} ${t('transactions.transactionGroups.groupsPage.transactionCountLabel')}`
      : '',
  ]
    .filter(Boolean)
    .join(' · '),
);

// Group summary — amounts are aggregated in the user's base currency (refAmount),
// since transactions in the group may live in different currencies.
const summary = computed(() => {
  let income = 0;
  let expense = 0;
  for (const tx of transactions.value) {
    if (tx.transactionType === TRANSACTION_TYPES.income) {
      income += tx.refAmount;
    } else {
      expense += tx.refAmount;
    }
  }
  const hasBothTypes = income > 0 && expense > 0;
  return {
    net: income - expense,
    income,
    expense,
    hasBothTypes,
  };
});
</script>

<template>
  <ResponsiveDialog :open="open" dialog-content-class="sm:max-w-2xl" @update:open="emit('update:open', $event)">
    <template #title>
      <div class="flex items-start gap-2">
        <span class="min-w-0 py-1.5 wrap-anywhere">{{
          group?.name ?? $t('transactionGroups.groupDialog.loadingText')
        }}</span>

        <DropdownMenu v-if="group">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="ml-auto shrink-0"
              :aria-label="$t('transactions.transactionGroups.groupsPage.moreActions', { name: group.name })"
            >
              <EllipsisIcon class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-44">
            <DropdownMenuItem @select="startEdit">
              <PencilIcon class="size-4" />
              {{ $t('transactionGroups.groupDialog.editAction') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="text-destructive-text hover:bg-destructive-text/10 focus:bg-destructive-text/10 focus:text-destructive-text"
              @select="openDeleteConfirm"
            >
              <Trash2Icon class="size-4" />
              {{ $t('transactionGroups.groupDialog.deleteAction') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>
    <template #description>
      <template v-if="metaLine">{{ metaLine }}</template>
    </template>

    <div v-if="isLoading" class="space-y-3 py-4">
      <div v-for="i in 3" :key="i" class="bg-muted h-12 animate-pulse rounded" />
    </div>

    <div v-else-if="group" class="space-y-4 py-2">
      <div v-if="group.note">
        <p ref="noteEl" :class="cn('text-muted-foreground text-sm wrap-anywhere', !isNoteExpanded && 'line-clamp-2')">
          {{ group.note }}
        </p>
        <Button
          v-if="isNoteClamped || isNoteExpanded"
          variant="link"
          class="h-auto p-0 text-sm"
          :aria-expanded="isNoteExpanded"
          @click="isNoteExpanded = !isNoteExpanded"
        >
          {{
            isNoteExpanded
              ? $t('transactionGroups.groupDialog.showLessNote')
              : $t('transactionGroups.groupDialog.showMoreNote')
          }}
        </Button>
      </div>

      <div class="@container/summary">
        <div
          :class="
            cn(
              'divide-border bg-muted/30 grid divide-y rounded-xl border @md/summary:divide-y-0',
              summary.hasBothTypes && '@md/summary:grid-cols-3 @md/summary:divide-x',
            )
          "
        >
          <div :class="SUMMARY_CELL">
            <p :class="SUMMARY_LABEL">{{ $t('transactionGroups.groupDialog.summary.net') }}</p>
            <p :class="cn(SUMMARY_VALUE, summary.net >= 0 ? 'text-app-income-color' : 'text-app-expense-color')">
              {{ formatCompactBaseCurrency({ amount: summary.net }) }}
            </p>
          </div>
          <template v-if="summary.hasBothTypes">
            <div :class="SUMMARY_CELL">
              <p :class="SUMMARY_LABEL">{{ $t('transactionGroups.groupDialog.summary.moneyIn') }}</p>
              <p :class="cn(SUMMARY_VALUE, 'text-app-income-color')">
                {{ formatCompactBaseCurrency({ amount: summary.income }) }}
              </p>
            </div>
            <div :class="SUMMARY_CELL">
              <p :class="SUMMARY_LABEL">{{ $t('transactionGroups.groupDialog.summary.moneyOut') }}</p>
              <p :class="cn(SUMMARY_VALUE, 'text-app-expense-color')">
                {{ formatCompactBaseCurrency({ amount: summary.expense }) }}
              </p>
            </div>
          </template>
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-medium">{{ $t('transactionGroups.groupDialog.transactionsLabel') }}</h4>
          <Button variant="outline" size="sm" :aria-pressed="isManaging" @click="isManaging = !isManaging">
            <component :is="isManaging ? CheckIcon : PencilIcon" class="size-4" />
            {{ isManaging ? $t('common.actions.done') : $t('transactionGroups.groupDialog.manageTransactions') }}
          </Button>
        </div>
        <div class="bg-muted/30 rounded-xl border p-1">
          <TransactionsList raw-list compact :hide-date="isSingleDay" :paginate="false" :transactions="transactions">
            <template v-if="isManaging" #row-trailing="{ tx }">
              <DesktopOnlyTooltip :content="$t('transactionGroups.groupDialog.removeFromGroup')">
                <Button
                  variant="soft-destructive"
                  size="icon-sm"
                  class="mr-1 size-9 shrink-0 sm:size-7"
                  :aria-label="$t('transactionGroups.groupDialog.removeFromGroup')"
                  @click.stop="handleRemoveTransaction({ transactionId: tx.id })"
                >
                  <XIcon class="size-3.5" />
                </Button>
              </DesktopOnlyTooltip>
            </template>
          </TransactionsList>
        </div>
      </div>
    </div>
  </ResponsiveDialog>

  <EditGroupDialog v-model:open="isEditDialogOpen" :group="group ?? null" @saved="handleEditSaved" />

  <!-- Delete group confirmation -->
  <ResponsiveAlertDialog
    v-model:open="isDeleteConfirmOpen"
    confirm-label="Delete"
    confirm-variant="destructive"
    @confirm="handleDelete"
  >
    <template #title>{{ $t('transactionGroups.groupDialog.deleteGroupTitle') }}</template>
    <template #description>
      {{ $t('transactionGroups.groupDialog.deleteGroupDescription', { groupName: group?.name }) }}
    </template>
  </ResponsiveAlertDialog>

  <!-- Remove transaction confirmation -->
  <ResponsiveAlertDialog
    v-model:open="removeConfirm.isOpen"
    :confirm-label="
      wouldDissolve
        ? $t('transactionGroups.groupDialog.removeAndDeleteButtonText')
        : $t('transactionGroups.groupDialog.removeButtonText')
    "
    confirm-variant="destructive"
    @confirm="confirmRemoveTransaction"
  >
    <template #title>{{ $t('transactionGroups.groupDialog.removeTransactionTitle') }}</template>
    <template #description>
      <template v-if="wouldDissolve">
        {{ $t('transactionGroups.groupDialog.removeTransactionDescription') }}
      </template>
      <template v-else>
        {{ $t('transactionGroups.groupDialog.removeTransactionDescriptionNormal') }}
      </template>
    </template>
  </ResponsiveAlertDialog>
</template>
