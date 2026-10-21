<script setup lang="ts">
import * as transactionGroupsApi from '@/api/transaction-groups';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { invalidateTransactionGroupQueries } from '@/composable/data-queries/transaction-groups';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { format } from 'date-fns';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { EllipsisVerticalIcon, PencilIcon, Trash2Icon, XIcon } from '@lucide/vue';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormatCurrency } from '@/composable/formatters';
import EditGroupDialog from './edit-group-dialog.vue';

const { t } = useI18n();
const { formatCompactBaseCurrency } = useFormatCurrency();

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

// Actions popover
const isActionsPopoverOpen = ref(false);

// Edit dialog
const isEditDialogOpen = ref(false);

const startEdit = () => {
  isActionsPopoverOpen.value = false;
  isEditDialogOpen.value = true;
};

const handleEditSaved = () => {
  invalidateAll();
  emit('updated');
};

// Delete group
const isDeleteConfirmOpen = ref(false);

const openDeleteConfirm = () => {
  isActionsPopoverOpen.value = false;
  isDeleteConfirmOpen.value = true;
};

const handleDelete = async () => {
  if (!props.groupId) return;
  await transactionGroupsApi.deleteTransactionGroup({ id: props.groupId });
  isDeleteConfirmOpen.value = false;
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

  const result = await transactionGroupsApi.removeTransactionsFromGroup({
    groupId: props.groupId,
    transactionIds: [removeConfirm.transactionId],
    force: wouldDissolve.value || undefined,
  });

  removeConfirm.isOpen = false;

  if (result.dissolved) {
    emit('update:open', false);
    emit('deleted');
  }

  invalidateAll();
};

// Date range display
const dateRange = computed(() => {
  if (!group.value?.transactions?.length) return '';
  const dates = group.value.transactions.map((tx) => new Date(tx.time));
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  const from = format(min, 'd MMM yyyy');
  const to = format(max, 'd MMM yyyy');
  return from === to ? from : `${from} – ${to}`;
});

const transactions = computed(() => group.value?.transactions ?? []);

// Group summary — amounts are aggregated in the user's base currency (refAmount),
// since transactions in the group may live in different currencies.
const summary = computed(() => {
  let income = 0;
  let expense = 0;
  for (const tx of transactions.value) {
    // A transaction with no base-currency amount (custom currency, no rate yet) adds nothing to the summary.
    if (tx.refAmount === null) continue;
    if (tx.transactionType === TRANSACTION_TYPES.income) {
      income += tx.refAmount;
    } else {
      expense += tx.refAmount;
    }
  }
  const hasBothTypes = income > 0 && expense > 0;
  return {
    count: transactions.value.length,
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
      <div class="flex items-center gap-2">
        {{ group?.name ?? t('transactionGroups.groupDialog.loadingText') }}

        <Popover v-if="group" v-model:open="isActionsPopoverOpen">
          <PopoverTrigger as-child>
            <Button variant="ghost" size="icon" class="ml-auto">
              <EllipsisVerticalIcon class="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="flex w-auto min-w-40 flex-col gap-1 p-1">
            <Button variant="ghost" size="sm" class="w-full justify-start" @click="startEdit">
              <PencilIcon class="mr-2 size-4" />
              {{ t('transactionGroups.groupDialog.editAction') }}
            </Button>
            <Button variant="ghost-destructive" size="sm" class="w-full justify-start" @click="openDeleteConfirm">
              <Trash2Icon class="mr-2 size-4" />
              {{ t('transactionGroups.groupDialog.deleteAction') }}
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </template>
    <template #description>
      <template v-if="dateRange">{{ dateRange }}</template>
    </template>

    <div v-if="isLoading" class="space-y-3 py-4">
      <div v-for="i in 3" :key="i" class="bg-muted h-12 animate-pulse rounded" />
    </div>

    <div v-else-if="group" class="space-y-4 py-2">
      <div v-if="group.note" class="text-muted-foreground text-sm">
        {{ group.note }}
      </div>

      <div class="@container">
        <div
          class="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border"
          :class="summary.hasBothTypes ? '@sm:grid-cols-4' : '@sm:grid-cols-2'"
        >
          <div class="bg-muted/30 px-4 py-2.5">
            <p class="text-muted-foreground text-xs">
              {{ t('transactionGroups.groupDialog.summary.transactions') }}
            </p>
            <p class="text-lg font-semibold">{{ summary.count }}</p>
          </div>
          <div class="bg-muted/30 px-4 py-2.5">
            <p class="text-muted-foreground text-xs">
              {{ t('transactionGroups.groupDialog.summary.net') }}
            </p>
            <p
              class="text-lg font-semibold whitespace-nowrap"
              :class="summary.net >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
            >
              {{ formatCompactBaseCurrency({ amount: summary.net }) }}
            </p>
          </div>
          <template v-if="summary.hasBothTypes">
            <div class="bg-muted/30 px-4 py-2.5">
              <p class="text-muted-foreground text-xs">
                {{ t('transactionGroups.groupDialog.summary.moneyIn') }}
              </p>
              <p class="text-app-income-color text-lg font-semibold whitespace-nowrap">
                {{ formatCompactBaseCurrency({ amount: summary.income }) }}
              </p>
            </div>
            <div class="bg-muted/30 px-4 py-2.5">
              <p class="text-muted-foreground text-xs">
                {{ t('transactionGroups.groupDialog.summary.moneyOut') }}
              </p>
              <p class="text-app-expense-color text-lg font-semibold whitespace-nowrap">
                {{ formatCompactBaseCurrency({ amount: summary.expense }) }}
              </p>
            </div>
          </template>
        </div>
      </div>

      <div class="space-y-1">
        <h4 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {{ t('transactionGroups.groupDialog.transactionsLabel') }} ({{ transactions.length }})
        </h4>
        <TransactionsList raw-list :paginate="false" :transactions="transactions">
          <template #row-trailing="{ tx }">
            <Button
              variant="ghost-destructive"
              size="icon"
              @click.stop="handleRemoveTransaction({ transactionId: tx.id })"
            >
              <XIcon class="size-3.5" />
            </Button>
          </template>
        </TransactionsList>
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
    <template #title>{{ t('transactionGroups.groupDialog.deleteGroupTitle') }}</template>
    <template #description>
      {{ t('transactionGroups.groupDialog.deleteGroupDescription', { groupName: group?.name }) }}
    </template>
  </ResponsiveAlertDialog>

  <!-- Remove transaction confirmation -->
  <ResponsiveAlertDialog
    v-model:open="removeConfirm.isOpen"
    :confirm-label="
      wouldDissolve
        ? t('transactionGroups.groupDialog.removeAndDeleteButtonText')
        : t('transactionGroups.groupDialog.removeButtonText')
    "
    confirm-variant="destructive"
    @confirm="confirmRemoveTransaction"
  >
    <template #title>{{ t('transactionGroups.groupDialog.removeTransactionTitle') }}</template>
    <template #description>
      <template v-if="wouldDissolve">
        {{ t('transactionGroups.groupDialog.removeTransactionDescription') }}
      </template>
      <template v-else>
        {{ t('transactionGroups.groupDialog.removeTransactionDescriptionNormal') }}
      </template>
    </template>
  </ResponsiveAlertDialog>
</template>
