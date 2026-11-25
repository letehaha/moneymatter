<template>
  <Card class="@container/activity min-w-0">
    <CardHeader class="pb-4">
      <PillTabs
        :model-value="filter"
        :items="filterItems"
        @update:model-value="(value) => (filter = value as PortfolioActivityFilter)"
      />
    </CardHeader>
    <CardContent class="pt-0">
      <Callout v-if="activityQuery.isLoadingError.value" variant="destructive">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="min-w-0 font-semibold">{{ $t('portfolioDetail.activity.loadError') }}</p>
          <Button type="button" variant="outline" size="sm" @click="activityQuery.refetch()">
            {{ $t('common.actions.retry') }}
          </Button>
        </div>
      </Callout>

      <div v-else-if="isLoading" class="space-y-3">
        <div v-for="i in SKELETON_ROWS" :key="i" class="flex items-center justify-between py-2">
          <div class="flex items-center gap-3">
            <div class="bg-muted size-8 animate-pulse rounded-full" />
            <div class="space-y-1.5">
              <div class="bg-muted h-4 w-24 animate-pulse rounded" />
              <div class="bg-muted h-3 w-16 animate-pulse rounded" />
            </div>
          </div>
          <div class="bg-muted h-4 w-20 animate-pulse rounded" />
        </div>
      </div>

      <div v-else-if="!activityQuery.items.value.length" class="flex flex-col items-center py-12 text-center">
        <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
          <HistoryIcon class="text-muted-foreground size-6" />
        </div>
        <template v-if="filter === PORTFOLIO_ACTIVITY_FILTERS.all">
          <h3 class="mb-2 text-lg font-semibold">{{ $t('portfolioDetail.activity.empty.title') }}</h3>
          <p class="text-muted-foreground max-w-md text-sm">{{ $t('portfolioDetail.activity.empty.description') }}</p>
        </template>
        <h3 v-else class="text-lg font-semibold">{{ $t('portfolioDetail.activity.empty.filteredTitle') }}</h3>
      </div>

      <div v-else class="-mx-2 divide-y">
        <template v-for="item in activityQuery.items.value" :key="`${item.kind}-${item.id}`">
          <TradeActivityRow v-if="item.kind === 'trade'" :trade="item" :portfolio-id="portfolioId" />
          <TransferActivityRow
            v-else
            :transfer="item"
            :portfolio-id="portfolioId"
            :delete-disabled="deleteMutation.isPending.value"
            @edit="openEditDialog({ transfer: item })"
            @delete="openDeleteDialog({ transfer: item })"
          />
        </template>
      </div>

      <Callout v-if="activityQuery.isFetchNextPageError.value" variant="destructive" class="mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="min-w-0 font-semibold">{{ $t('portfolioDetail.activity.loadError') }}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :loading="activityQuery.isFetchingNextPage.value"
            :disabled="activityQuery.isFetchingNextPage.value"
            @click="activityQuery.fetchNextPage()"
          >
            {{ $t('common.actions.retry') }}
          </Button>
        </div>
      </Callout>

      <div v-else-if="activityQuery.hasNextPage.value" ref="sentinelRef" class="flex justify-center p-3">
        <Loader2Icon v-if="activityQuery.isFetchingNextPage.value" class="text-muted-foreground size-4 animate-spin" />
      </div>
    </CardContent>

    <EditCashTransactionDialog v-model:open="isEditDialogOpen" :portfolio-id="portfolioId" :transfer="transferToEdit" />

    <ResponsiveAlertDialog
      v-model:open="isDeleteDialogOpen"
      :cancel-label="$t('forms.directCashTransaction.cancelButton')"
      :confirm-label="$t('portfolioDetail.actions.delete')"
      confirm-variant="destructive"
      :confirm-disabled="deleteMutation.isPending.value"
      @confirm="confirmDelete"
    >
      <template #title>
        {{ $t('portfolioDetail.cashBalances.cashTransactions.deleteConfirm') }}
      </template>
      <template v-if="transferToDelete?.transactionId" #description>
        {{ $t('portfolioDetail.cashBalances.cashTransactions.linkedTransactionNote') }}
      </template>

      <RadioGroup v-if="transferToDelete?.transactionId" v-model="linkedTxAction" class="gap-3">
        <div class="flex items-center gap-2">
          <RadioGroupItem id="keep" value="keep" />
          <Label for="keep" class="cursor-pointer text-sm font-normal">
            {{ $t('portfolioDetail.cashBalances.cashTransactions.keepLinkedTransaction') }}
          </Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroupItem id="delete" value="delete" />
          <Label for="delete" class="cursor-pointer text-sm font-normal">
            {{ $t('portfolioDetail.cashBalances.cashTransactions.deleteLinkedTransaction') }}
          </Label>
        </div>
      </RadioGroup>
    </ResponsiveAlertDialog>
  </Card>
</template>

<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Label } from '@/components/lib/ui/label';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { useNotificationCenter } from '@/components/notification-center';
import { usePortfolioActivity } from '@/composable/data-queries/portfolio-activity';
import { useDeletePortfolioTransfer } from '@/composable/data-queries/portfolio-transfers';
import { getApiErrorMessage } from '@/js/errors';
import EditCashTransactionDialog from '@/pages/portfolios/components/edit-cash-transaction-dialog.vue';
import {
  PORTFOLIO_ACTIVITY_FILTERS,
  type PortfolioActivityFilter,
  type PortfolioTransferModel,
} from '@bt/shared/types/investments';
import { useIntersectionObserver } from '@vueuse/core';
import { HistoryIcon, Loader2Icon } from '@lucide/vue';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

import TradeActivityRow from './trade-activity-row.vue';
import TransferActivityRow from './transfer-activity-row.vue';

const SKELETON_ROWS = 3;

const props = defineProps<{ portfolioId: string }>();
const portfolioId = toRef(props, 'portfolioId');

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const filter = ref<PortfolioActivityFilter>(PORTFOLIO_ACTIVITY_FILTERS.all);
const filterItems = computed(() => [
  { value: PORTFOLIO_ACTIVITY_FILTERS.all, label: t('portfolioDetail.activity.filters.all') },
  { value: PORTFOLIO_ACTIVITY_FILTERS.trades, label: t('portfolioDetail.activity.filters.trades') },
  { value: PORTFOLIO_ACTIVITY_FILTERS.cash, label: t('portfolioDetail.activity.filters.cash') },
  { value: PORTFOLIO_ACTIVITY_FILTERS.income, label: t('portfolioDetail.activity.filters.income') },
]);

const activityQuery = usePortfolioActivity({ portfolioId, type: filter });
const isLoading = computed(() => !activityQuery.isFetched.value);

const sentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(sentinelRef, ([entry]) => {
  if (entry?.isIntersecting && activityQuery.hasNextPage.value && !activityQuery.isFetchingNextPage.value) {
    activityQuery.fetchNextPage();
  }
});

const isEditDialogOpen = ref(false);
const transferToEdit = ref<PortfolioTransferModel | null>(null);

const openEditDialog = ({ transfer }: { transfer: PortfolioTransferModel }) => {
  transferToEdit.value = transfer;
  isEditDialogOpen.value = true;
};

const deleteMutation = useDeletePortfolioTransfer();
const linkedTxAction = ref<'keep' | 'delete'>('keep');
const isDeleteDialogOpen = ref(false);
const transferToDelete = ref<PortfolioTransferModel | null>(null);

const openDeleteDialog = ({ transfer }: { transfer: PortfolioTransferModel }) => {
  transferToDelete.value = transfer;
  linkedTxAction.value = 'keep';
  isDeleteDialogOpen.value = true;
};

const confirmDelete = async () => {
  const transfer = transferToDelete.value;
  if (!transfer) return;

  try {
    await deleteMutation.mutateAsync({
      portfolioId: props.portfolioId,
      transferId: transfer.id,
      deleteLinkedTransaction: transfer.transactionId ? linkedTxAction.value === 'delete' : undefined,
    });
    addSuccessNotification(t('dialogs.deleteInvestmentTransaction.notifications.success'));
  } catch (err) {
    addErrorNotification(
      getApiErrorMessage({
        e: err,
        t,
        conflictKey: 'dialogs.deleteInvestmentTransaction.notifications.error',
        fallbackKey: 'dialogs.deleteInvestmentTransaction.notifications.error',
      }),
    );
  } finally {
    isDeleteDialogOpen.value = false;
  }
};
</script>
