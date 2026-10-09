<template>
  <div class="flex min-h-screen items-center justify-center px-4">
    <div class="w-full max-w-md rounded-lg p-8 shadow-lg">
      <div v-if="isProcessing" class="text-center">
        <InfoIcon class="mx-auto mb-4 size-12" />

        <h2 class="mb-2 text-xl font-semibold">{{ t('pages.bankCallback.processing.title') }}</h2>

        <p class="text-muted-foreground text-sm">{{ t('pages.bankCallback.processing.description') }}</p>
      </div>

      <div v-else-if="error" class="text-center">
        <InfoIcon class="text-destructive-text mx-auto mb-4 size-12" />

        <h2 class="text-destructive-text mb-2 text-xl font-semibold">{{ t('pages.bankCallback.error.title') }}</h2>

        <p class="text-muted-foreground mb-2 text-sm">{{ error }}</p>
        <p class="mb-6 text-sm">
          <DocsLink path="/import/bank-connections/#connect-with-enable-banking" />
        </p>
        <button
          @click="goToIntegrations"
          class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          {{ t('pages.bankCallback.error.backToIntegrations') }}
        </button>
      </div>

      <div v-else-if="success" class="text-center">
        <CheckCircle2Icon class="text-success-text mx-auto mb-4 size-12" />

        <h2 class="text-success-text mb-2 text-xl font-semibold">{{ t('pages.bankCallback.success.title') }}</h2>

        <p class="text-muted-foreground mb-6 text-sm">{{ t('pages.bankCallback.success.description') }}</p>

        <button
          @click="goToAccounts"
          class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          {{ t('pages.bankCallback.success.viewAccounts') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { completeEnableBankingOAuth } from '@/api/bank-data-providers';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import DocsLink from '@/components/common/docs-link.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore } from '@/stores/accounts';
import { useQueryClient } from '@tanstack/vue-query';
import { CheckCircle2Icon, InfoIcon } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const syncStatus = useSyncStatus();
const accountsStore = useAccountsStore();

const isProcessing = ref(true);
const error = ref('');
const success = ref(false);

onMounted(async () => {
  // Get query parameters from URL
  const code = route.query.code as string;
  const state = route.query.state as string;
  const errorParam = route.query.error as string;
  const errorDescription = route.query.error_description as string;

  // Check for OAuth errors
  if (errorParam) {
    error.value = errorDescription || errorParam || t('pages.bankCallback.errors.authorizationDenied');
    isProcessing.value = false;
    addErrorNotification(error.value);
    return;
  }

  // Validate required parameters
  if (!code || !state) {
    error.value = t('pages.bankCallback.errors.missingParameters');
    isProcessing.value = false;
    addErrorNotification(error.value);
    return;
  }

  // Get connection ID from localStorage (set by EnableBankingConnector)
  const connectionId = localStorage.getItem('pendingEnableBankingConnectionId');

  if (!connectionId) {
    error.value = t('pages.bankCallback.errors.connectionIdNotFound');
    isProcessing.value = false;
    addErrorNotification(error.value);
    return;
  }

  try {
    // Complete OAuth flow
    await completeEnableBankingOAuth(connectionId, code, state);

    // Clear stored connection ID
    localStorage.removeItem('pendingEnableBankingConnectionId');

    // Refresh global UI state so the sidebar's "needs reauth" triangle, the
    // account details banner, and the connection details view all reflect the
    // newly-reactivated connection without requiring a manual page reload.
    // Use Promise.allSettled so a cache-refresh failure doesn't override the
    // success state and bounce the user back to the "OAuth failed" screen —
    // the server-side reconnect already succeeded by this point.
    const refreshResults = await Promise.allSettled([
      // A reconnect queues a sync server-side, so watch it; triggering one here would double-sync.
      syncStatus.watchSync(),
      queryClient.invalidateQueries({
        predicate: (query) => (query.queryKey as string[]).includes(VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange),
      }),
      accountsStore.refetchAccounts(),
    ]);
    for (const result of refreshResults) {
      if (result.status === 'rejected') {
        console.error('Post-OAuth cache refresh failed:', result.reason);
      }
    }

    success.value = true;
    addSuccessNotification(t('pages.integrations.notifications.connectionEstablished'));

    setTimeout(() => {
      router.push({
        name: ROUTES_NAMES.accountIntegrationDetails,
        params: { connectionId },
      });
    }, 2000);
  } catch (err) {
    const message = err instanceof Error ? err.message : t('pages.bankCallback.errors.failedToComplete');
    error.value = message;
    addErrorNotification(message);
  } finally {
    isProcessing.value = false;
  }
});

const goToIntegrations = () => {
  router.push({ name: ROUTES_NAMES.accounts });
};

const goToAccounts = () => {
  router.push({ name: ROUTES_NAMES.accounts });
};
</script>
