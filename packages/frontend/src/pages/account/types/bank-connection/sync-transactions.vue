<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <div>
        <p>{{ t('pages.account.syncTransactions.title') }}</p>
        <p class="text-muted-foreground text-sm">{{ t('pages.account.syncTransactions.autoSyncInfo') }}</p>
      </div>

      <Button :disabled="isSyncDisabled" class="min-w-25" size="sm" @click="syncTransactionsHandler">
        <RefreshCw class="size-4" :class="{ 'animate-spin': isSyncing || isAccountSyncing }" />
        {{
          isSyncing || isAccountSyncing
            ? t('pages.account.syncTransactions.syncing')
            : t('pages.account.syncTransactions.syncButton')
        }}
      </Button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { syncTransactions } from '@/api/bank-data-providers';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { API_ERROR_CODES, AccountModel } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { RefreshCw } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  account: AccountModel;
}>();

const queryClient = useQueryClient();
const { addNotification } = useNotificationCenter();
const { accountStatuses, watchSync } = useSyncStatus();

// Check if there's an active sync for this specific account
const isAccountSyncing = computed(() => {
  const status = accountStatuses.value.find((s) => s.accountId === props.account.id);
  return status?.status === 'syncing' || status?.status === 'queued';
});

// Mutation for syncing transactions
const { mutate: syncMutate, isPending: isSyncing } = useMutation({
  mutationFn: async () => {
    if (!props.account.bankDataProviderConnectionId) {
      throw new Error(t('pages.account.syncTransactions.notLinked'));
    }

    await watchSync();

    return syncTransactions(props.account.bankDataProviderConnectionId, props.account.id);
  },
  onSuccess: (response) => {
    // Check if response has jobGroupId (queue-based sync like Monobank)
    if ('jobGroupId' in response) {
      addNotification({
        text: t(
          'pages.account.syncTransactions.syncQueued',
          { batches: response.totalBatches, minutes: response.estimatedMinutes },
          response.totalBatches,
        ),
        type: NotificationType.info,
      });
      // SSE will provide updates as sync progresses
    } else {
      // Immediate sync (EnableBanking) - SSE will notify when complete
      addNotification({
        text: t('pages.account.syncTransactions.syncStarted'),
        type: NotificationType.info,
      });

      queryClient.invalidateQueries({
        queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
      });
    }
  },
  onError: (error: unknown) => {
    const e = error as { data?: { code?: string; message?: string } };
    if (e?.data?.code === API_ERROR_CODES.forbidden) {
      addNotification({
        text: e.data.message || t('pages.account.syncTransactions.accessForbidden'),
        type: NotificationType.error,
      });
    } else {
      console.error(error);
      addNotification({
        text: t('pages.account.syncTransactions.failed'),
        type: NotificationType.error,
      });
    }
  },
});

const isSyncDisabled = computed(() => isSyncing.value || isAccountSyncing.value);

const syncTransactionsHandler = () => {
  if (!props.account.bankDataProviderConnectionId) {
    addNotification({
      text: t('pages.account.syncTransactions.notLinked'),
      type: NotificationType.error,
    });
    return;
  }

  syncMutate();
};
</script>
