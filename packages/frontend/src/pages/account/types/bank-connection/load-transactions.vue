<script lang="ts" setup>
import { loadTransactionsForPeriod as apiLoadTransactions } from '@/api/bank-data-providers';
import { Button } from '@/components/lib/ui/button';
import { DateSelector } from '@/components/lib/ui/date-selector';
import * as Tooltip from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { type Period } from '@/composable/use-period-navigation';
import { useSyncStatus } from '@/composable/use-sync-status';
import { ACCOUNT_TYPES, AccountModel } from '@bt/shared/types';
import { differenceInDays, startOfDay, subDays } from 'date-fns';
import { CalendarIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  account: AccountModel;
}>();

const { addNotification } = useNotificationCenter();
const { accountStatuses, watchSync } = useSyncStatus();

// Check if there's an active sync for this specific account
const isAccountSyncing = computed(() => {
  const status = accountStatuses.value.find((s) => s.accountId === props.account.id);
  return status?.status === 'syncing' || status?.status === 'queued';
});

// Mirrors the backend providers that implement `loadTransactionsForPeriod`.
const PROVIDERS_WITH_PERIOD_SYNC: ACCOUNT_TYPES[] = [ACCOUNT_TYPES.monobank, ACCOUNT_TYPES.simplefin];
const isPeriodSyncSupported = computed(() => PROVIDERS_WITH_PERIOD_SYNC.includes(props.account.type));

// Backend caps a historical load at one year (see load-transactions-for-period controller).
const MAX_DATE_RANGE_DAYS = 365;

const yesterday = startOfDay(subDays(new Date(), 1));

const dateRange = ref<Period>({
  from: yesterday,
  to: yesterday,
});
const isLoading = ref(false);

const handlePeriodUpdate = async (period: Period) => {
  dateRange.value = period;

  if (!props.account.bankDataProviderConnectionId) {
    addNotification({
      text: t('pages.account.loadTransactions.notLinked'),
      type: NotificationType.error,
    });
    return;
  }

  try {
    const { from, to } = period;

    // Validate date range (max 1 year)
    const daysDiff = differenceInDays(to, from);
    if (daysDiff > MAX_DATE_RANGE_DAYS) {
      addNotification({
        text: t('pages.account.loadTransactions.dateRangeExceeds'),
        type: NotificationType.error,
      });
      return;
    }

    isLoading.value = true;

    await watchSync();

    const result = await apiLoadTransactions(
      props.account.bankDataProviderConnectionId,
      props.account.id,
      from.toISOString(),
      to.toISOString(),
    );

    // Inline providers (jobGroupId === null) have already finished: success only if
    // the window had data. Queue-based providers (e.g. Monobank) report async progress.
    const isInlineWithData = result.jobGroupId === null && Boolean(result.createdCount || result.fetchedCount);
    addNotification({
      text: result.message,
      type: isInlineWithData ? NotificationType.success : NotificationType.info,
    });

    // SSE will provide updates as sync progresses (queue-based providers)
  } catch (error) {
    const e = error as { data?: { message?: string } };
    addNotification({
      text: e?.data?.message || t('pages.account.loadTransactions.failed'),
      type: NotificationType.error,
      visibilityTime: 10_000, // 10 seconds for error messages to give user time to read
    });
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="flex items-center justify-between">
    <p>{{ t('pages.account.loadTransactions.title') }}</p>

    <Tooltip.TooltipProvider v-if="!isPeriodSyncSupported">
      <Tooltip.Tooltip :delay-duration="0">
        <Tooltip.TooltipTrigger as-child>
          <span class="inline-block">
            <Button disabled class="pointer-events-none min-w-25" size="sm">
              <CalendarIcon class="size-4" />
              {{ t('pages.account.loadTransactions.selectPeriod') }}
            </Button>
          </span>
        </Tooltip.TooltipTrigger>
        <Tooltip.TooltipContent>
          {{ t('pages.account.loadTransactions.notSupportedByProvider') }}
        </Tooltip.TooltipContent>
      </Tooltip.Tooltip>
    </Tooltip.TooltipProvider>

    <DateSelector
      v-else
      :model-value="dateRange"
      :allowed-filter-modes="['between']"
      @update:model-value="handlePeriodUpdate"
    >
      <template #trigger="{ triggerText }">
        <Button :disabled="isLoading || isAccountSyncing" class="min-w-25" size="sm">
          <CalendarIcon class="size-4" />
          {{ isLoading || isAccountSyncing ? t('pages.account.loadTransactions.loading') : triggerText }}
        </Button>
      </template>
    </DateSelector>
  </div>
</template>
