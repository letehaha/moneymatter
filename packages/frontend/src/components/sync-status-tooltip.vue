<template>
  <div class="max-w-100 min-w-70 p-2">
    <p class="mb-3 text-sm">{{ $t('syncStatusTooltip.title') }}</p>

    <!-- Just completed: success / partial-failure banner -->
    <div
      v-if="showSuccessMessage"
      class="mb-3 flex items-center gap-2 rounded-md p-3 text-sm"
      :class="hasFailedAccounts ? 'bg-destructive/10 text-destructive-text' : 'bg-success text-success-text'"
    >
      <component :is="hasFailedAccounts ? XCircleIcon : CheckCircle2" class="size-5 shrink-0" />
      <span class="font-medium">{{
        hasFailedAccounts ? $t('syncStatusTooltip.syncCompletedWithErrors') : $t('syncStatusTooltip.syncedSuccessfully')
      }}</span>
    </div>

    <!-- Stuck-sync banner -->
    <Callout v-if="syncStuck" variant="destructive" :title="$t('syncStatusTooltip.syncStuckTitle')" class="mb-3">
      <p class="text-xs opacity-80">{{ $t('syncStatusTooltip.syncStuckDescription') }}</p>
    </Callout>

    <!-- Connections needing reauth: connection was auto-deactivated after the
         bank rejected the session/refresh token, so the user must reconnect. -->
    <div v-if="connectionsNeedingReauth.length > 0" class="mb-3 space-y-2">
      <div class="text-destructive-text flex items-center gap-2 text-xs font-medium">
        <AlertTriangleIcon class="size-4 shrink-0" />
        {{ $t('syncStatusTooltip.needsReauthTitle') }}
      </div>
      <p class="text-muted-foreground text-[10px]">{{ $t('syncStatusTooltip.needsReauthDescription') }}</p>
      <div class="space-y-2">
        <div
          v-for="connection in connectionsNeedingReauth"
          :key="connection.connectionId"
          class="border-destructive/40 bg-destructive/5 flex items-center gap-2 rounded border p-2"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-medium">
              {{ connection.bankName || connection.providerName }}
            </div>
            <div class="text-muted-foreground text-[10px]">
              {{ getProviderName(connection.providerType) }} ·
              {{ $t('syncStatusTooltip.affectedAccounts', connection.accountsCount) }}
            </div>
          </div>
          <Button as-child size="sm" variant="destructive" class="shrink-0">
            <RouterLink
              :to="{ name: ROUTES_NAMES.accountIntegrationDetails, params: { connectionId: connection.connectionId } }"
            >
              {{ $t('syncStatusTooltip.reconnectButton') }}
            </RouterLink>
          </Button>
        </div>
      </div>
    </div>

    <!-- In-progress: progress bar -->
    <div v-if="isSyncing" class="mb-3 space-y-2">
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium">{{
          $t('syncStatusTooltip.progress', { current: syncProgress.current, total: syncProgress.total })
        }}</span>
        <span class="text-muted-foreground">{{
          $t('syncStatusTooltip.progressPercentage', { percentage: syncProgress.percentage })
        }}</span>
      </div>
      <div class="bg-muted h-2 overflow-hidden rounded-full">
        <div class="bg-primary h-full transition-all duration-300" :style="{ width: `${syncProgress.percentage}%` }" />
      </div>
    </div>

    <!-- Default view header: last sync time -->
    <div v-if="showDefaultHeader" class="text-muted-foreground mb-3 text-xs">
      <template v-if="lastSyncTimestamp">
        {{ $t('syncStatusTooltip.lastSynced') }} {{ formatLastSyncTime(lastSyncTimestamp) }}
      </template>
      <template v-else>{{ $t('syncStatusTooltip.neverSynced') }}</template>
    </div>

    <!-- Empty state: no bank accounts -->
    <div
      v-if="!isSyncing && accountStatuses.length === 0 && connectionsNeedingReauth.length === 0"
      class="text-muted-foreground flex flex-col items-center gap-2 py-4 text-center text-sm"
    >
      <Building2 class="size-10 opacity-50" />
      <span>{{ $t('syncStatusTooltip.noBankAccounts') }}</span>
      <Button as-child size="sm" class="mt-4 w-full">
        <RouterLink :to="{ name: ROUTES_NAMES.accounts, query: { connect: 'bank' } }">{{
          $t('syncStatusTooltip.connectButton')
        }}</RouterLink>
      </Button>
    </div>

    <!-- Scrollable account list (accounts in progress, queued, or failed). Cap
         the viewport height directly — the popover doesn't establish a
         definite height, so flex-1/min-h-0 on the root won't constrain. -->
    <ScrollArea v-if="visibleAccounts.length > 0" class="-mx-2" viewport-class="max-h-[40dvh]">
      <div class="space-y-2 px-2">
        <div
          v-for="account in visibleAccounts"
          :key="account.accountId"
          class="border-border flex flex-col gap-1 rounded border p-2 text-xs"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex-1 truncate">
              <div class="max-w-50 truncate font-medium">{{ account.accountName }}</div>
              <div class="text-muted-foreground text-[10px]">
                {{ getProviderName(account.providerType) }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <component
                :is="getStatusIcon(account.status)"
                :class="[getStatusColor(account.status), { 'animate-spin': account.status === SyncStatus.SYNCING }]"
                class="size-3"
              />
              <span :class="getStatusColor(account.status)" class="text-[10px] font-medium uppercase">
                {{ getStatusText(account.status) }}
              </span>
            </div>
          </div>
          <p
            v-if="account.status === SyncStatus.FAILED && account.error"
            class="text-muted-foreground line-clamp-2 text-[10px] wrap-break-word"
          >
            {{ account.error }}
          </p>
        </div>
      </div>
    </ScrollArea>

    <!-- AI categorization section (always rendered, doesn't scroll with the list) -->
    <div
      v-if="isCategorizing || categorizationJustCompleted || showBadge({ feature: AI_FEATURE.categorization })"
      class="border-border mt-3 space-y-2 border-t pt-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <SparklesIcon class="text-primary-text size-4" />
        <span class="text-sm font-medium">{{ $t('header.categorization.title') }}</span>
        <AiUsageBadge :feature="AI_FEATURE.categorization" />
      </div>

      <template v-if="categorizationJustCompleted && categorizationStatus?.status === 'completed'">
        <div class="text-success-text flex items-center gap-2 text-xs">
          <CheckCircle2 class="size-4" />
          <span>{{ $t('header.categorization.completedShort') }}</span>
        </div>
      </template>

      <template v-else-if="categorizationJustCompleted && categorizationStatus?.status === 'failed'">
        <div class="text-destructive-text flex items-center gap-2 text-xs">
          <XCircleIcon class="size-4" />
          <span>{{ $t('header.categorization.failedShort') }}</span>
        </div>
      </template>

      <template v-else-if="isCategorizing && categorizationStatus">
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              {{ categorizationStatus.processedCount }} / {{ categorizationStatus.totalCount }}
              {{ $t('header.categorization.transactions') }}
            </span>
            <span class="text-muted-foreground">{{ categorizationProgress }}%</span>
          </div>
          <div class="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              class="bg-primary h-full transition-all duration-300"
              :style="{ width: `${categorizationProgress}%` }"
            />
          </div>
        </div>

        <div v-if="categorizationStatus.status === 'queued'" class="text-muted-foreground text-xs">
          {{ $t('header.categorization.queued') }}
        </div>
      </template>
    </div>

    <!-- Action buttons -->
    <div v-if="showActions" class="mt-3 flex flex-col gap-2">
      <Button
        v-if="canSync"
        class="w-full"
        size="sm"
        :disabled="isLoading || accountStatuses.length === 0"
        @click="$emit('triggerSync')"
      >
        <RefreshCcw :class="{ 'animate-spin': isLoading }" class="mr-2 size-4" />
        {{
          syncStuck || hasFailedAccounts
            ? $t('syncStatusTooltip.retrySyncButton')
            : $t('syncStatusTooltip.syncNowButton')
        }}
      </Button>
      <Button v-if="hasFailedAccounts || syncStuck" as-child variant="outline" size="sm" class="w-full">
        <RouterLink :to="{ name: ROUTES_NAMES.accounts }">
          {{ $t('syncStatusTooltip.manageConnectionsButton') }}
        </RouterLink>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type AccountSyncStatus, type ConnectionNeedingReauth, SyncStatus } from '@/api/bank-data-providers';
import { METAINFO_FROM_TYPE } from '@/common/const/bank-providers';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { ROUTES_NAMES } from '@/routes/constants';
import { AI_FEATURE, type AiCategorizationProgressPayload } from '@bt/shared/types';
import {
  AlertTriangleIcon,
  Building2,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  RefreshCcw,
  SparklesIcon,
  XCircleIcon,
} from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { showBadge } = useAiAllowance();

const props = defineProps<{
  accountStatuses: AccountSyncStatus[];
  connectionsNeedingReauth: ConnectionNeedingReauth[];
  syncProgress: { current: number; total: number; percentage: number };
  lastSyncTimestamp: number | null;
  isLoading?: boolean;
  isSyncing?: boolean;
  syncStuck?: boolean;
  showSuccessMessage?: boolean;
  // AI Categorization props
  categorizationStatus?: AiCategorizationProgressPayload | null;
  isCategorizing?: boolean;
  categorizationProgress?: number;
  categorizationJustCompleted?: boolean;
}>();

defineEmits<{
  triggerSync: [];
}>();

// Accounts surfaced in the scrollable list:
// - while syncing: anything not yet COMPLETED
// - otherwise: only FAILED ones, so the user can see and act on them
const visibleAccounts = computed<AccountSyncStatus[]>(() => {
  if (props.isSyncing) {
    return props.accountStatuses.filter(
      (account) =>
        account.status === SyncStatus.QUEUED ||
        account.status === SyncStatus.SYNCING ||
        account.status === SyncStatus.FAILED,
    );
  }
  return props.accountStatuses.filter((account) => account.status === SyncStatus.FAILED);
});

const failedAccounts = computed(() => {
  return props.accountStatuses.filter((account) => account.status === SyncStatus.FAILED);
});

const hasFailedAccounts = computed(() => failedAccounts.value.length > 0);

const showDefaultHeader = computed(
  () => !props.isSyncing && !props.showSuccessMessage && !props.syncStuck && props.accountStatuses.length > 0,
);

const canSync = computed(() => !props.isSyncing && props.accountStatuses.length > 0);

const showActions = computed(() => canSync.value || props.syncStuck);

const getProviderName = (providerType: string) => {
  const meta = METAINFO_FROM_TYPE[providerType];
  if (!meta) {
    console.warn(`[sync-status-tooltip] Unknown provider type: ${providerType}`);
    return '';
  }
  return t(meta.nameKey);
};

const getStatusIcon = (status: SyncStatus) => {
  switch (status) {
    case SyncStatus.SYNCING:
      return Loader2;
    case SyncStatus.QUEUED:
      return Clock;
    case SyncStatus.COMPLETED:
      return CheckCircle2;
    case SyncStatus.FAILED:
      return XCircleIcon;
    default:
      return Circle;
  }
};

const getStatusColor = (status: SyncStatus) => {
  switch (status) {
    case SyncStatus.SYNCING:
      return 'text-primary-text';
    case SyncStatus.QUEUED:
      return 'text-yellow-500';
    case SyncStatus.COMPLETED:
      return 'text-green-500';
    case SyncStatus.FAILED:
      return 'text-destructive-text';
    default:
      return 'text-gray-400';
  }
};

const getStatusText = (status: SyncStatus) => {
  switch (status) {
    case SyncStatus.SYNCING:
      return t('syncStatusTooltip.statuses.syncing');
    case SyncStatus.QUEUED:
      return t('syncStatusTooltip.statuses.queued');
    case SyncStatus.COMPLETED:
      return t('syncStatusTooltip.statuses.synced');
    case SyncStatus.FAILED:
      return t('syncStatusTooltip.statuses.failed');
    default:
      return t('syncStatusTooltip.statuses.idle');
  }
};

const formatLastSyncTime = (timestamp: number) => {
  const diffMs = Date.now() - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
  const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  const diffYears = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));

  if (diffYears > 0) {
    return t('syncStatusTooltip.timeAgo.yearsAgo', diffYears);
  }
  if (diffMonths > 0) {
    return t('syncStatusTooltip.timeAgo.monthsAgo', diffMonths);
  }
  if (diffWeeks > 0) {
    return t('syncStatusTooltip.timeAgo.weeksAgo', diffWeeks);
  }
  if (diffDays > 0) {
    return t('syncStatusTooltip.timeAgo.daysAgo', diffDays);
  }
  if (diffHours > 0) {
    return t('syncStatusTooltip.timeAgo.hoursAgo', diffHours);
  }
  if (diffMinutes > 0) {
    return t('syncStatusTooltip.timeAgo.minutesAgo', diffMinutes);
  }
  if (diffSeconds > 5) {
    return t('syncStatusTooltip.timeAgo.secondsAgo', diffSeconds);
  }
  return t('syncStatusTooltip.timeAgo.justNow');
};
</script>
