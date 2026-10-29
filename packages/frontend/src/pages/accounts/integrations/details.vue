<template>
  <PageWrapper class="w-full max-w-5xl">
    <IntegrationDetailsSkeleton v-if="isLoading" />

    <ResourceNotFound
      v-else-if="isConnectionNotFound"
      :title="$t('pages.integrations.details.error.notFoundTitle')"
      :description="$t('pages.integrations.details.error.notFoundDescription')"
      :link-label="$t('pages.integrations.details.error.backButton')"
      :link-to="{ name: ROUTES_NAMES.accounts }"
    />

    <div
      v-else-if="error"
      class="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center md:p-12"
    >
      <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
        <SearchXIcon class="text-muted-foreground size-8" />
      </div>
      <h2 class="mb-2 text-xl font-semibold tracking-wide">
        {{ $t('pages.integrations.details.error.unexpectedTitle') }}
      </h2>
      <p class="text-muted-foreground mb-6 max-w-md">
        {{ $t('pages.integrations.details.error.unexpectedDescription') }}
      </p>
      <UiButton @click="router.push({ name: ROUTES_NAMES.accounts })">
        <ArrowLeftIcon class="size-4" />
        {{ $t('pages.integrations.details.error.backButton') }}
      </UiButton>
    </div>

    <template v-else-if="connectionDetails">
      <div class="@container/connection">
        <div class="flex items-center gap-3">
          <UiButton
            variant="ghost"
            size="icon-sm"
            :aria-label="$t('pages.integrations.details.error.backButton')"
            @click="router.push({ name: ROUTES_NAMES.accounts })"
          >
            <ArrowLeftIcon class="size-4" />
          </UiButton>

          <BankConnectionLogo
            :connection-id="connectionId"
            :alt="connectionDetails.providerName"
            size="size-7"
            class="rounded-md"
          />

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 class="truncate text-xl font-semibold tracking-tight">{{ connectionDetails.providerName }}</h1>

              <DesktopOnlyTooltip :content="$t('pages.integrations.details.actions.renameButton')">
                <UiButton
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="$t('pages.integrations.details.actions.renameButton')"
                  @click="openEditNameDialog"
                >
                  <PencilIcon class="size-3.5" />
                </UiButton>
              </DesktopOnlyTooltip>

              <StatusBadge :variant="connectionDetails.isActive ? 'success' : 'destructive'">
                {{
                  connectionDetails.isActive
                    ? $t('pages.integrations.details.connectionDetails.statusActive')
                    : $t('pages.integrations.details.connectionDetails.statusInactive')
                }}
              </StatusBadge>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <UiButton variant="outline" size="sm" :aria-label="$t('common.ui.actions')">
                <EllipsisIcon class="size-4" />
                <span class="hidden @md/connection:inline">
                  {{ $t('pages.integrations.details.actions.manage') }}
                </span>
              </UiButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="min-w-48">
              <DropdownMenuItem @select="openEditNameDialog">
                <PencilIcon class="size-4" />
                {{ $t('pages.integrations.details.actions.renameButton') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive-text"
                :disabled="isDisconnecting"
                @select="openDisconnectDialog"
              >
                <UnlinkIcon class="size-4" />
                {{ $t('pages.integrations.details.actions.disconnectButton') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <!-- pl-[84px] = back button (32) + logo (28) + two gap-3 (24), aligning with the title. -->
        <div
          class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums @md/connection:mt-1 @md/connection:pl-21"
        >
          <span class="inline-flex items-center gap-1.5">
            <BankProviderLogo class="size-4 rounded-sm" :provider="connectionDetails.providerType" />
            {{ providerDisplayName }}
          </span>
          <span aria-hidden="true">·</span>
          <span>{{ $t('pages.integrations.details.meta.connectedSince', { date: connectedSinceLabel }) }}</span>
        </div>

        <Card class="@container/summary mt-4">
          <div class="flex flex-col @2xl/summary:flex-row @2xl/summary:items-center">
            <div
              class="border-border/60 shrink-0 border-b p-4 @2xl/summary:border-b-0 @2xl/summary:p-5 @2xl/summary:pr-8"
            >
              <div class="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                {{
                  leadTotalLabel === null
                    ? $t('pages.integrations.details.summary.accounts')
                    : $t('pages.integrations.details.summary.totalBalance')
                }}
              </div>
              <div class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                {{ leadTotalLabel ?? connectionDetails.accounts.length }}
              </div>
              <div class="text-muted-foreground mt-1 text-xs">{{ summarySubtitle }}</div>
            </div>

            <div
              :class="
                cn(
                  'grid grid-cols-2',
                  '@max-2xl/summary:[&>div]:border-border/60 @max-2xl/summary:[&>div]:p-4 @max-2xl/summary:[&>div:nth-child(n+3)]:border-t @max-2xl/summary:[&>div:nth-child(odd):last-child]:col-span-2 @max-2xl/summary:[&>div:nth-child(odd):not(:last-child)]:border-r',
                  '@2xl/summary:border-border/60 @2xl/summary:flex-1 @2xl/summary:gap-x-6 @2xl/summary:border-l @2xl/summary:p-5',
                  connectionDetails.consent ? '@2xl/summary:grid-cols-4' : '@2xl/summary:grid-cols-3',
                )
              "
            >
              <div>
                <div class="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                  {{ $t('pages.integrations.details.summary.accounts') }}
                </div>
                <div class="mt-1 text-base font-semibold tabular-nums">{{ accountsStatValue }}</div>
                <div v-if="totalAvailableCount" class="text-muted-foreground mt-0.5 text-xs">
                  {{ $t('pages.integrations.details.summary.connectedSub') }}
                </div>
              </div>
              <div>
                <div class="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                  {{ $t('pages.integrations.details.connectionDetails.autoSync') }}
                </div>
                <div class="mt-1 text-base font-semibold tabular-nums">{{ autoSyncStatLabel }}</div>
              </div>
              <div>
                <div class="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                  {{ $t('pages.integrations.details.summary.lastSync') }}
                </div>
                <div class="mt-1 text-base font-semibold tabular-nums">{{ lastSyncLabel }}</div>
                <div v-if="failedSyncCount" class="text-destructive-text mt-0.5 text-xs">
                  {{ $t('pages.integrations.details.summary.accountsFailed', failedSyncCount) }}
                </div>
              </div>
              <div v-if="connectionDetails.consent">
                <div class="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                  {{ $t('pages.integrations.details.summary.consent') }}
                </div>
                <div class="mt-1 text-base font-semibold tabular-nums" :class="consentStatClass">
                  {{ consentStatLabel }}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div
          v-if="
            connectionDetails.consent &&
            (connectionDetails.consent.isExpired || connectionDetails.consent.isExpiringSoon)
          "
          :class="
            cn(
              'mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm',
              connectionDetails.consent.isExpired
                ? 'border-destructive/25 bg-destructive/5 text-destructive-text'
                : 'border-warning/25 bg-warning/10 text-warning-text',
            )
          "
        >
          <TriangleAlertIcon class="size-4 shrink-0" />
          <p class="min-w-40 flex-1 tabular-nums">
            {{
              connectionDetails.consent.isExpired
                ? $t('pages.integrations.details.consentStrip.expired')
                : $t(
                    'pages.integrations.details.consentStrip.expiring',
                    {
                      days: connectionDetails.consent.daysRemaining ?? 0,
                      date: consentValidUntilLabel,
                    },
                    connectionDetails.consent.daysRemaining ?? 0,
                  )
            }}
          </p>
          <UiButton variant="outline" size="sm" class="w-full @sm/connection:w-auto" @click="openReconnectDialog">
            {{ $t('pages.integrations.details.connectionValidity.reconnectButton') }}
          </UiButton>
        </div>

        <!-- Enable Banking is excluded: OAuth credentials can't be re-supplied inline. -->
        <div
          v-if="needsReconnect && connectionDetails.providerType !== BANK_PROVIDER_TYPE.ENABLE_BANKING"
          class="border-destructive/25 bg-destructive/5 text-destructive-text mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm"
        >
          <CircleAlertIcon class="size-4 shrink-0" />
          <p class="min-w-40 flex-1">{{ $t('pages.integrations.authFailure.description') }}</p>
          <UiButton
            variant="outline"
            size="sm"
            class="w-full @sm/connection:w-auto"
            @click="isUpdateCredentialsDialogOpen = true"
          >
            <KeyRoundIcon class="size-4" />
            {{ $t('pages.integrations.authFailure.updateButton') }}
          </UiButton>
        </div>

        <div class="mt-6 mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2 px-1">
          <div class="flex items-center gap-2">
            <h2 class="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
              {{ $t('pages.integrations.details.connectedAccounts.title') }}
            </h2>
            <span class="text-muted-foreground/70 text-xs font-medium tabular-nums">
              {{ connectionDetails.accounts.length }}
            </span>
          </div>

          <UiButton
            v-if="canSyncNow"
            variant="ghost-primary"
            size="sm"
            :disabled="isSyncNowBusy"
            @click="handleSyncNow"
          >
            <RefreshCwIcon :class="cn('size-4', isSyncNowBusy && 'animate-spin')" />
            {{ $t('pages.integrations.details.connectedAccounts.syncNow') }}
          </UiButton>
        </div>

        <ConnectionAccountsTable
          :accounts="connectionDetails.accounts"
          :remaining-count="remainingAccountsCount"
          :needs-attention-count="failedSyncCount"
          :total-label="leadTotalLabel"
          @connect-remaining="openFetchAccountsDialog"
        />
      </div>

      <!-- Update Credentials Dialog -->
      <Dialog v-model:open="isUpdateCredentialsDialogOpen">
        <DialogContent class="max-w-md">
          <DialogHeader class="mb-4">
            <DialogTitle>{{ $t('pages.integrations.updateCredentials.title') }}</DialogTitle>
          </DialogHeader>
          <div class="space-y-4">
            <InputField
              v-model="newApiKey"
              type="password"
              :label="
                connectionDetails.providerType === BANK_PROVIDER_TYPE.AKAHU
                  ? $t('pages.integrations.akahu.userTokenLabel')
                  : $t('pages.integrations.updateCredentials.apiKeyLabel')
              "
              :placeholder="
                connectionDetails.providerType === BANK_PROVIDER_TYPE.AKAHU
                  ? $t('pages.integrations.akahu.userTokenPlaceholder')
                  : $t('pages.integrations.updateCredentials.apiKeyPlaceholder')
              "
            />
            <TextareaField
              v-if="connectionDetails.providerType === BANK_PROVIDER_TYPE.WALUTOMAT"
              v-model="newPrivateKey"
              :rows="6"
              :label="$t('pages.integrations.walutomat.privateKeyLabel')"
              :placeholder="$t('pages.integrations.walutomat.privateKeyPlaceholder')"
            />
            <InputField
              v-else-if="connectionDetails.providerType === BANK_PROVIDER_TYPE.AKAHU"
              v-model="newPrivateKey"
              type="password"
              :label="$t('pages.integrations.akahu.appTokenLabel')"
              :placeholder="$t('pages.integrations.akahu.appTokenPlaceholder')"
            />
          </div>
          <DialogFooter class="mt-6 grid gap-3 sm:grid-cols-2">
            <UiButton variant="outline" @click="isUpdateCredentialsDialogOpen = false">
              {{ $t('common.actions.cancel') }}
            </UiButton>
            <UiButton :disabled="!canUpdateCredentials || isUpdatingCredentials" @click="handleUpdateCredentials">
              {{
                isUpdatingCredentials
                  ? $t('pages.integrations.updateCredentials.updatingButton')
                  : $t('pages.integrations.updateCredentials.updateButton')
              }}
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </template>

    <!-- Fetch Accounts Dialog -->
    <ConnectAccountsDialog
      v-model:open="isFetchAccountsDialogOpen"
      :accounts="availableAccounts"
      :is-loading="isLoadingAvailableAccounts"
      :error-type="availableAccountsErrorType"
      :connected-external-ids="connectedExternalIds"
      :provider-name="connectionDetails?.providerName ?? ''"
      :provider-type="connectionDetails?.providerType"
      :is-connecting="isSyncingAccounts"
      @connect="handleSyncSelectedAccounts"
    />

    <!-- Disconnect Dialog -->
    <DisconnectIntegrationDialog
      v-model:open="isDisconnectDialogOpen"
      :is-disconnecting="isDisconnecting"
      @confirm="handleDisconnectConfirm"
    />

    <!-- Edit Connection Name Dialog -->
    <EditConnectionNameDialog
      v-model:open="isEditNameDialogOpen"
      :provider-name="connectionDetails?.providerName || ''"
      :is-saving="isSavingName"
      @save="handleSaveConnectionName"
    />

    <!-- Reconnect Confirmation Dialog -->
    <ReconnectConfirmationDialog
      v-model:open="isReconnectDialogOpen"
      :is-pending="isReconnectPending"
      @confirm="handleReconnect"
    />
  </PageWrapper>
</template>

<script lang="ts" setup>
import {
  SyncStatus,
  disconnectProvider,
  getAvailableAccounts,
  reauthorizeConnection,
  syncConnection,
  syncSelectedAccounts,
  updateConnectionDetails,
} from '@/api/bank-data-providers';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { METAINFO_FROM_TYPE } from '@/common/const/bank-providers';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import BankConnectionLogo from '@/components/common/bank-connection-logo.vue';
import BankProviderLogo from '@/components/common/bank-providers/bank-provider-logo.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import PageWrapper from '@/components/common/page-wrapper.vue';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card } from '@/components/lib/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/lib/ui/dialog';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useBankConnectionDetails } from '@/composable/data-queries/bank-providers/bank-connection-details';
import { useFormatCurrency } from '@/composable/formatters';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { useDateLocale } from '@/composable/use-date-locale';
import { useSyncStatus } from '@/composable/use-sync-status';
import { ApiErrorResponseError, isNotFoundError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useAccountsStore } from '@/stores';
import { BANK_PROVIDER_TYPE, DEACTIVATION_REASON } from '@bt/shared/types';
import { API_ERROR_CODES } from '@bt/shared/types/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  EllipsisIcon,
  KeyRoundIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchXIcon,
  TriangleAlertIcon,
  UnlinkIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import ConnectAccountsDialog from './components/connect-accounts-dialog.vue';
import ConnectionAccountsTable from './components/connection-accounts-table.vue';
import DisconnectIntegrationDialog from './components/disconnect-integration-dialog.vue';
import EditConnectionNameDialog from './components/edit-connection-name-dialog.vue';
import IntegrationDetailsSkeleton from './components/integration-details-skeleton.vue';
import ReconnectConfirmationDialog from './components/reconnect-confirmation-dialog.vue';
import { buildProviderCredentials } from './utils/build-provider-credentials';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const queryClient = useQueryClient();

const connectionId = computed(() => String(route.params.connectionId));
const isFetchAccountsDialogOpen = ref(false);
const isDisconnectDialogOpen = ref(false);
const isEditNameDialogOpen = ref(false);
const isReconnectDialogOpen = ref(false);
const isUpdateCredentialsDialogOpen = ref(false);
const newApiKey = ref('');
const newPrivateKey = ref('');

const isReconnectPending = ref(false);

const { format: formatDateLocale, formatDistanceToNow } = useDateLocale();
const { formatAmountByCurrencyCode, formatBaseCurrency } = useFormatCurrency();

const {
  data: connectionDetails,
  isLoading,
  error,
} = useBankConnectionDetails({ connectionId: connectionId, queryOptions: { retry: false } });

const isConnectionNotFound = computed(() => isNotFoundError(error.value));

const providerDisplayName = computed(() => {
  const meta = METAINFO_FROM_TYPE[connectionDetails.value?.providerType ?? ''];
  return meta ? t(meta.nameKey) : (connectionDetails.value?.provider.name ?? '');
});

const MS_PER_HOUR = 60 * 60 * 1000;

const autoSyncIntervalHours = computed(() => {
  const features = connectionDetails.value?.provider.features;
  if (!features?.supportsAutoSync || !features.defaultSyncInterval) return null;
  return Math.round(features.defaultSyncInterval / MS_PER_HOUR);
});

const autoSyncStatLabel = computed(() =>
  autoSyncIntervalHours.value === null
    ? t('pages.integrations.details.summary.autoSyncOff')
    : t('pages.integrations.details.summary.every', { hours: autoSyncIntervalHours.value }),
);

const lastSyncLabel = computed(() => {
  const lastSyncAt = connectionDetails.value?.lastSyncAt;
  if (!lastSyncAt) return t('pages.integrations.details.relativeTime.never');
  return formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true });
});

const connectedSinceLabel = computed(() =>
  connectionDetails.value ? formatDateLocale(connectionDetails.value.createdAt, 'MMM yyyy') : '',
);

const consentValidUntilLabel = computed(() => {
  const validUntil = connectionDetails.value?.consent?.validUntil;
  return validUntil
    ? formatDateLocale(validUntil, 'PP')
    : t('pages.integrations.details.connectionValidity.notAvailable');
});

const consentStatLabel = computed(() => {
  const consent = connectionDetails.value?.consent;
  if (!consent) return '';
  if (consent.isExpired) return t('pages.integrations.details.connectionValidity.statusExpired');
  if (consent.daysRemaining === null) return t('pages.integrations.details.connectionValidity.statusActive');
  return t('pages.integrations.details.connectionValidity.daysCount', consent.daysRemaining);
});

const consentStatClass = computed(() => {
  const consent = connectionDetails.value?.consent;
  if (!consent) return '';
  if (consent.isExpired) return 'text-destructive-text';
  if (consent.isExpiringSoon) return 'text-warning-text';
  return 'text-success-text';
});

const { accountsRecord } = storeToRefs(useAccountsStore());
const { sumBaseBalance } = useBaseBalanceTotals();

// When some accounts aren't in the store yet, fall back to a plain sum if all share one currency.
const leadTotalLabel = computed(() => {
  const accounts = connectionDetails.value?.accounts ?? [];
  if (!accounts.length) return null;

  const storeAccounts = accounts.map((account) => accountsRecord.value[account.id]).filter((account) => !!account);
  if (storeAccounts.length === accounts.length) {
    const { total, isApprox } = sumBaseBalance({ accounts: storeAccounts });
    return `${isApprox ? '≈ ' : ''}${formatBaseCurrency(total)}`;
  }

  const codes = new Set(accounts.map((account) => account.currencyCode));
  if (codes.size !== 1) return null;
  const total = accounts.reduce((sum, account) => sum + account.currentBalance, 0);
  return formatAmountByCurrencyCode(total, [...codes][0]!);
});

const summarySubtitle = computed(() => {
  const accounts = connectionDetails.value?.accounts ?? [];
  const countLabel = t('pages.integrations.details.summary.accountsCount', accounts.length);
  const codes = [...new Set(accounts.map((account) => account.currencyCode))];
  return codes.length > 1 ? `${codes.join(', ')} · ${countLabel}` : countLabel;
});

// A connection needs manual reconnection either after an auth failure or after a
// data-backup restore (restored connections come in with an empty credential stub).
const needsReconnect = computed(
  () =>
    connectionDetails.value &&
    !connectionDetails.value.isActive &&
    (connectionDetails.value.deactivationReason === DEACTIVATION_REASON.AUTH_FAILURE ||
      connectionDetails.value.deactivationReason === DEACTIVATION_REASON.RESTORED),
);

// Mutation for updating credentials
const { mutate: updateCredentialsMutation, isPending: isUpdatingCredentials } = useMutation({
  mutationFn: (credentials: Record<string, unknown>) => updateConnectionDetails(connectionId.value, { credentials }),
  onSuccess: () => {
    addSuccessNotification(t('pages.integrations.updateCredentials.success'));
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange);
      },
    });
    isUpdateCredentialsDialogOpen.value = false;
    newApiKey.value = '';
    newPrivateKey.value = '';
  },
  onError: (err) => {
    const message = err instanceof Error ? err.message : t('pages.integrations.updateCredentials.failed');
    addErrorNotification(message);
  },
});

const canUpdateCredentials = computed(() => {
  if (!newApiKey.value.trim()) return false;
  if (
    connectionDetails.value?.providerType === BANK_PROVIDER_TYPE.WALUTOMAT ||
    connectionDetails.value?.providerType === BANK_PROVIDER_TYPE.AKAHU
  ) {
    return !!newPrivateKey.value.trim();
  }
  return true;
});

const handleUpdateCredentials = () => {
  if (!canUpdateCredentials.value) return;

  const credentials = buildProviderCredentials({
    providerType: connectionDetails.value?.providerType,
    apiKey: newApiKey.value.trim(),
    privateKey: newPrivateKey.value.trim(),
  });
  updateCredentialsMutation(credentials);
};

// Loaded eagerly so the "N of M" stat and the connect-remaining count render without
// opening the dialog. Failures (e.g. expired provider session) just hide the counts.
const {
  data: availableAccounts,
  isLoading: isLoadingAvailableAccounts,
  error: availableAccountsError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.bankAvailableExternalAccounts, connectionId],
  queryFn: () => getAvailableAccounts(connectionId.value),
  enabled: computed(() => isFetchAccountsDialogOpen.value || !!connectionDetails.value?.isActive),
  retry: false,
  staleTime: 5 * 60 * 1000,
});

const totalAvailableCount = computed(() => availableAccounts.value?.length ?? null);

const remainingAccountsCount = computed(() => {
  if (!availableAccounts.value) return null;
  return availableAccounts.value.filter((account) => !isAccountConnected(account.externalId)).length;
});

const accountsStatValue = computed(() => {
  const connected = connectionDetails.value?.accounts.length ?? 0;
  if (totalAvailableCount.value === null) return String(connected);
  return t('pages.integrations.details.summary.connectedOf', {
    connected,
    total: Math.max(totalAvailableCount.value, connected),
  });
});

const { accountStatuses, syncStuck, watchSync, fetchStatus } = useSyncStatus();

const connectionAccountIds = computed(() => new Set((connectionDetails.value?.accounts ?? []).map((a) => a.id)));

const failedSyncCount = computed(
  () =>
    accountStatuses.value.filter(
      (status) => connectionAccountIds.value.has(status.accountId) && status.status === SyncStatus.FAILED,
    ).length,
);

const canSyncNow = computed(
  () =>
    !!connectionDetails.value?.isActive &&
    !!connectionDetails.value.provider.features.supportsManualSync &&
    connectionDetails.value.accounts.length > 0,
);

const isConnectionSyncing = computed(() =>
  accountStatuses.value.some(
    (status) =>
      connectionAccountIds.value.has(status.accountId) &&
      (status.status === SyncStatus.QUEUED || status.status === SyncStatus.SYNCING),
  ),
);

// The sync runs in the background, so its failure is only visible in the statuses.
watch(isConnectionSyncing, (syncing, wasSyncing) => {
  if (wasSyncing && !syncing && failedSyncCount.value > 0) {
    addErrorNotification(t('pages.integrations.details.connectedAccounts.syncFailed'));
  }
});

const { mutate: syncNowMutation, isPending: isSyncingNow } = useMutation({
  mutationFn: async () => {
    // Subscribe first: a sync that finishes before the SSE connects is never reported.
    await watchSync();
    const result = await syncConnection({ connectionId: connectionId.value });
    // Without this the queued state is only seen if the SSE connection is up.
    await fetchStatus();
    return result;
  },
  onSuccess: ({ queuedAccounts }) => {
    // Nothing queued means the cached connection is stale (deactivated or emptied since load).
    if (queuedAccounts === 0) {
      queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange] });
      return;
    }
    addSuccessNotification(t('pages.integrations.details.connectedAccounts.syncStarted'));
  },
  onError: () => {
    addErrorNotification(t('pages.integrations.details.connectedAccounts.syncFailed'));
  },
});

// `syncStuck` frees the button when a finished sync's last status update never arrived.
const isSyncNowBusy = computed(() => isSyncingNow.value || (isConnectionSyncing.value && !syncStuck.value));

const handleSyncNow = () => syncNowMutation();

// Mutation for syncing selected accounts
const { mutate: syncAccountsMutation, isPending: isSyncingAccounts } = useMutation({
  mutationFn: ({
    externalIds,
    currencyOverrides,
  }: {
    externalIds: string[];
    currencyOverrides: Record<string, string>;
  }) => syncSelectedAccounts(connectionId.value, externalIds, currencyOverrides),
  onSuccess: () => {
    void watchSync();
    addSuccessNotification(t('pages.integrations.notifications.connectAccountsSuccess'));
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];

        return (
          queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange) ||
          queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange) ||
          queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.currencies)
        );
      },
    });
    isFetchAccountsDialogOpen.value = false;
  },
  onError: (err) => {
    // Surface the backend message — e.g. which account still needs a currency.
    const message =
      err instanceof Error && err.message ? err.message : t('pages.integrations.notifications.connectAccountsFailed');
    addErrorNotification(message);
  },
});

// Mutation for disconnecting provider
const { mutate: disconnectMutation, isPending: isDisconnecting } = useMutation({
  mutationFn: disconnectProvider,
  onSuccess: () => {
    addSuccessNotification(t('pages.integrations.notifications.disconnectSuccess'));
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return (
          queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange) ||
          queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange)
        );
      },
    });
    router.push({ name: ROUTES_NAMES.accounts });
  },
  onError: () => {
    addErrorNotification(t('pages.integrations.notifications.disconnectFailed'));
  },
});

// Mutation for updating connection name
const { mutate: updateNameMutation, isPending: isSavingName } = useMutation({
  mutationFn: ({ connectionId: connId, providerName }: { connectionId: string; providerName: string }) =>
    updateConnectionDetails(connId, { providerName }),
  onSuccess: () => {
    addSuccessNotification(t('pages.integrations.notifications.updateNameSuccess'));
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange);
      },
    });
    isEditNameDialogOpen.value = false;
  },
  onError: () => {
    addErrorNotification(t('pages.integrations.notifications.updateNameFailed'));
  },
});

const connectedExternalIds = computed(
  () => new Set((connectionDetails.value?.accounts ?? []).map((account) => account.externalId)),
);

const isAccountConnected = (externalId: string): boolean => connectedExternalIds.value.has(externalId);

const availableAccountsErrorType = computed<'forbidden' | 'generic' | null>(() => {
  if (!availableAccountsError.value) return null;
  if (
    availableAccountsError.value instanceof ApiErrorResponseError &&
    availableAccountsError.value.data.code === API_ERROR_CODES.forbidden
  ) {
    return 'forbidden';
  }
  return 'generic';
});

const openFetchAccountsDialog = () => {
  isFetchAccountsDialogOpen.value = true;
};

const openDisconnectDialog = () => {
  isDisconnectDialogOpen.value = true;
};

const openEditNameDialog = () => {
  isEditNameDialogOpen.value = true;
};

const openReconnectDialog = () => {
  isReconnectDialogOpen.value = true;
};

const handleSaveConnectionName = (providerName: string) => {
  updateNameMutation({ connectionId: connectionId.value, providerName });
};

const handleSyncSelectedAccounts = (payload: { externalIds: string[]; currencyOverrides: Record<string, string> }) => {
  if (payload.externalIds.length === 0) return;
  syncAccountsMutation(payload);
};

const handleDisconnectConfirm = (removeAssociatedAccounts: boolean) => {
  disconnectMutation({
    connectionId: connectionId.value,
    removeAssociatedAccounts,
  });
};

const handleReconnect = async () => {
  try {
    isReconnectPending.value = true;
    // Call reauthorization API
    const response = await reauthorizeConnection(connectionId.value);

    // Store connection ID for OAuth callback
    localStorage.setItem('pendingEnableBankingConnectionId', String(connectionId.value));

    // Redirect to the authorization URL
    window.location.href = response.authUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : t('pages.integrations.details.errors.reauthorizationFailed');
    isReconnectPending.value = false;
    isReconnectDialogOpen.value = false;
    addErrorNotification(message);
  }
};
</script>
