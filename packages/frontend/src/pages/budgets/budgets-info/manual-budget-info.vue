<script setup lang="ts">
import { deleteBudget as deleteBudgetApi } from '@/api';
import { editBudget, loadBudgetById, loadBudgetStats } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import AlertDialog from '@/components/common/alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import ActionButton from '@/components/lib/ui/action-button/action-button.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import PillTabs from '@/components/lib/ui/pill-tabs/pill-tabs.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { captureException } from '@/lib/sentry';
import BudgetSharingPanel from '@/pages/budgets/components/budget-sharing-panel.vue';
import { ROUTES_NAMES } from '@/routes/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { cloneDeep } from 'lodash-es';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  CalendarIcon,
  PencilIcon,
  Trash2Icon,
  UsersIcon,
  WalletIcon,
} from '@lucide/vue';
import { computed, ref, toRef, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BudgetDetailSkeleton from './budget-detail-skeleton.vue';
import BudgetStatsCards from './shared/budget-stats-cards.vue';
import BudgetUtilizationBar from './shared/budget-utilization-bar.vue';
import { useArchiveToggle } from './shared/use-archive-toggle';
import { useBudgetDetails } from './shared/use-budget-details';
import BudgetStatistics from './statistics/budget-statistics.vue';
import TransactionsList from './transactions-list.vue';

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();
const budgetData = ref();
const currentBudgetId = ref<string>(route.params.id as string);
const isEditDialogOpen = ref(false);

const { data: budgetStats } = useQuery({
  queryFn: () => loadBudgetStats({ budgetId: currentBudgetId.value }),
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, currentBudgetId],
  staleTime: 30_000,
});

const { data: budgetItem, isLoading } = useQuery({
  queryFn: () => loadBudgetById(currentBudgetId.value),
  queryKey: [VUE_QUERY_CACHE_KEYS.budgetsListItem, currentBudgetId.value],
  staleTime: Infinity,
});

const { stats, formatDate, transactionDateRange, getBudgetTimeStatus, utilizationColor, utilizationTextColor } =
  useBudgetDetails({ budgetStats, budgetData });

// Share-derived auth on this budget. `canManage` gates the Edit/Archive/Sharing panel;
// `isOwner` gates Delete. Recipients on `read`/`write` see neither set of buttons.
const { isOwner, canManage, isSharedWithCaller, ownerHandle } = useBudgetAccess(toRef(() => budgetItem.value));

const { mutateAsync: editBudgetAsync, isPending: isBudgetDataUpdating } = useMutation({
  mutationFn: editBudget,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    queryClient.invalidateQueries({
      queryKey: [VUE_QUERY_CACHE_KEYS.budgetsListItem, currentBudgetId.value],
    });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetStats });
  },
});

const handleSaveFromDialog = async () => {
  try {
    await editBudgetAsync({
      budgetId: currentBudgetId.value,
      payload: {
        name: budgetData.value.name,
        limitAmount: budgetData.value.limitAmount,
      },
    });
    addSuccessNotification(t('budgets.list.updateSuccess'));
    isEditDialogOpen.value = false;
  } catch (err) {
    captureException({ error: err, context: { source: 'manualBudgetEdit', budgetId: currentBudgetId.value } });
    addErrorNotification(t('budgets.list.updateError'));
  }
};

const handleDeleteBudget = async () => {
  try {
    await deleteBudgetApi(currentBudgetId.value);
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    // Shared recipients see this budget in their shared-with-me list; clear that cache
    // too so it doesn't linger after the owner deletes the row.
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe });
    addSuccessNotification(t('budgets.list.deleteSuccess'));
    router.push({ name: ROUTES_NAMES.plannedBudgets });
  } catch (err) {
    captureException({ error: err, context: { source: 'manualBudgetDelete', budgetId: currentBudgetId.value } });
    addErrorNotification(t('budgets.list.deleteError'));
  }
};

const { isBudgetArchived, handleToggleArchive } = useArchiveToggle({ budgetData, budgetId: currentBudgetId });

const activeTab = ref('statistics');
const tabItems = computed(() => {
  const items = [
    { value: 'statistics', label: t('pages.budgetDetails.tabs.statistics') },
    { value: 'transactions', label: t('pages.budgetDetails.tabs.transactions') },
  ];
  if (canManage.value) {
    items.push({ value: 'sharing', label: t('pages.budgetDetails.tabs.sharing') });
  }
  return items;
});

watchEffect(() => {
  if (!isLoading.value && budgetItem.value) {
    budgetData.value = cloneDeep(budgetItem.value);
  }
});
</script>

<template>
  <div v-if="budgetData" class="@container max-w-5xl">
    <div class="mb-6">
      <!-- Hero Header -->
      <div class="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
        <div class="flex items-center gap-4">
          <div class="bg-muted flex size-12 shrink-0 items-center justify-center rounded-xl">
            <WalletIcon class="text-muted-foreground size-6" />
          </div>
          <div>
            <div class="flex items-center gap-3">
              <h1 class="text-2xl font-semibold tracking-tight">{{ budgetData.name }}</h1>
              <span
                v-if="isSharedWithCaller"
                class="bg-primary/10 text-primary-text inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                <UsersIcon class="size-3" />
                {{ $t('budgets.share.sharedByBadge', { handle: `@${ownerHandle}` }) }}
              </span>
              <span
                v-if="isBudgetArchived"
                class="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                <ArchiveIcon class="size-3" />
                {{ $t('budgets.list.archivedLabel') }}
              </span>
              <span
                v-if="getBudgetTimeStatus"
                :class="[
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  getBudgetTimeStatus?.status === 'ended'
                    ? 'bg-muted text-muted-foreground'
                    : getBudgetTimeStatus?.status === 'upcoming'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-success-text/10 text-success-text',
                ]"
              >
                {{ getBudgetTimeStatus?.text }}
              </span>
            </div>
            <!-- Transaction Date Range (based on actual linked transactions) -->
            <div v-if="transactionDateRange" class="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
              <CalendarIcon class="size-3.5" />
              <span v-if="transactionDateRange.first && transactionDateRange.last">
                {{ transactionDateRange.first }}
                <ArrowRightIcon class="inline size-3" />
                {{ transactionDateRange.last }}
              </span>
              <span v-else-if="transactionDateRange.first">{{ transactionDateRange.first }}</span>
              <span v-else-if="transactionDateRange.last">{{ transactionDateRange.last }}</span>
            </div>
            <p v-else class="text-muted-foreground mt-1 text-sm">{{ $t('pages.budgetDetails.noTransactionsYet') }}</p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div v-if="canManage" class="flex items-center gap-2">
          <ActionButton
            :action="handleToggleArchive"
            :label="isBudgetArchived ? t('budgets.list.unarchive') : t('budgets.list.archive')"
            :icon="isBudgetArchived ? ArchiveRestoreIcon : ArchiveIcon"
            size="sm"
            @error="addErrorNotification(t('budgets.list.archiveError'))"
          />

          <ResponsiveDialog v-model:open="isEditDialogOpen">
            <template #trigger>
              <Button variant="outline" size="sm">
                <PencilIcon class="mr-2 size-4" />
                {{ $t('budgets.manualBudget.edit') }}
              </Button>
            </template>
            <template #title>{{ $t('budgets.manualBudget.editTitle') }}</template>
            <div class="grid gap-4">
              <InputField
                v-model="budgetData.name"
                :label="$t('budgets.settings.nameLabel')"
                :placeholder="$t('budgets.settings.namePlaceholder')"
                class="w-full"
                :disabled="isBudgetDataUpdating"
              />
              <InputField
                v-model="budgetData.limitAmount"
                :label="$t('budgets.settings.limitLabel')"
                :placeholder="$t('budgets.settings.limitPlaceholder')"
                type="number"
                class="w-full"
                :disabled="isBudgetDataUpdating"
              />
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <span class="text-muted-foreground mb-1.5 block text-sm font-medium">
                    {{ $t('budgets.settings.startDateLabel') }}
                  </span>
                  <div
                    class="border-input bg-muted/50 text-muted-foreground flex h-10 items-center rounded-md border px-3 text-sm"
                  >
                    {{ formatDate(budgetData.startDate) || $t('budgets.settings.notSet') }}
                  </div>
                </div>
                <div>
                  <span class="text-muted-foreground mb-1.5 block text-sm font-medium">
                    {{ $t('budgets.settings.endDateLabel') }}
                  </span>
                  <div
                    class="border-input bg-muted/50 text-muted-foreground flex h-10 items-center rounded-md border px-3 text-sm"
                  >
                    {{ formatDate(budgetData.endDate) || $t('budgets.settings.notSet') }}
                  </div>
                </div>
              </div>
              <Button @click="handleSaveFromDialog" :disabled="isBudgetDataUpdating" class="w-full">
                <template v-if="isBudgetDataUpdating">{{ $t('common.actions.saving') }}</template>
                <template v-else>{{ $t('common.actions.saveChanges') }}</template>
              </Button>
            </div>
          </ResponsiveDialog>

          <AlertDialog
            v-if="isOwner"
            :title="$t('budgets.list.deleteDialog.title')"
            accept-variant="destructive"
            @accept="handleDeleteBudget"
          >
            <template #description>
              {{ $t('budgets.list.deleteDialog.description') }}
            </template>
            <template #trigger>
              <Button variant="outline" size="sm" class="text-destructive-text hover:bg-destructive-text/10">
                <Trash2Icon class="size-4" />
              </Button>
            </template>
          </AlertDialog>
        </div>
      </div>
    </div>

    <BudgetStatsCards :stats="stats" />

    <BudgetUtilizationBar
      v-if="budgetData.limitAmount"
      :limit-amount="budgetData.limitAmount"
      :stats="stats"
      :utilization-color="utilizationColor"
      :utilization-text-color="utilizationTextColor"
    />

    <PillTabs v-model="activeTab" :items="tabItems" class="mb-6" />

    <!-- Statistics Tab -->
    <BudgetStatistics v-if="activeTab === 'statistics'" :budget-id="currentBudgetId" />

    <!-- Transactions Tab -->
    <div v-else-if="activeTab === 'transactions'">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h2 class="text-lg font-medium">{{ $t('pages.budgetDetails.transactions') }}</h2>
          <p class="text-muted-foreground text-sm">
            {{ $t('pages.budgetDetails.transactionsLinked', stats.transactionsCount) }}
          </p>
        </div>
      </div>

      <TransactionsList :budget-id="currentBudgetId" :is-budget-data-updating="isBudgetDataUpdating" />
    </div>

    <!-- Sharing Tab — owners + manage recipients only. Recipients on read/write see the
         "shared by @owner" badge in the header instead and never see this tab. -->
    <BudgetSharingPanel v-else-if="activeTab === 'sharing' && canManage && budgetItem" :budget="budgetItem" />
  </div>

  <!-- Loading State -->
  <BudgetDetailSkeleton v-else />
</template>
