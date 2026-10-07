<template>
  <div ref="headerRef">
    <DemoBanner />
    <TrialBanner />
    <div
      ref="headerBarRef"
      class="shadow-header border-border @container/header-bar flex items-center justify-between border-b px-4 py-2 sm:px-6"
    >
      <div class="flex items-center gap-4">
        <template v-if="isMobileView">
          <Sheet.Sheet :open="isMobileSheetOpen" @update:open="isMobileSheetOpen = $event">
            <Sheet.SheetTrigger as-child>
              <Button size="icon-sm" variant="secondary" class="shrink-0">
                <MenuIcon class="size-4" />
              </Button>
            </Sheet.SheetTrigger>
            <Sheet.SheetContent
              side="left"
              :class="[
                'xs:w-3/4 w-full overflow-y-auto px-0',
                'data-[state=closed]:duration-200 data-[state=open]:duration-300',
              ]"
            >
              <Sheet.SheetTitle></Sheet.SheetTitle>
              <Sheet.SheetDescription></Sheet.SheetDescription>

              <Sidebar mobile-view />
            </Sheet.SheetContent>
          </Sheet.Sheet>
        </template>

        <div class="flex items-center gap-px">
          <ManageTransactionDialog v-model:open="isCreateTransactionDialogOpen" :prefill="createTransactionPrefill">
            <Button variant="default" size="sm" class="rounded-r-none">
              <PlusIcon class="size-4" />
              {{ isMobileView ? $t('header.add') : $t('header.newTransaction') }}
            </Button>
          </ManageTransactionDialog>

          <Popover.Popover v-model:open="isAddMenuOpen">
            <Popover.PopoverTrigger as-child>
              <Button variant="default" size="sm" class="rounded-l-none px-2" :aria-label="$t('header.moreActions')">
                <ChevronDownIcon class="size-4" />
              </Button>
            </Popover.PopoverTrigger>
            <Popover.PopoverContent class="grid w-72 gap-0.5 p-1.5" align="start">
              <RouterLink :to="{ name: ROUTES_NAMES.settingsDataManagement }" @click="isAddMenuOpen = false">
                <Button variant="ghost" class="h-auto w-full justify-start gap-3 p-2 text-left">
                  <span
                    class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md"
                  >
                    <ImportIcon class="size-4" />
                  </span>
                  <span class="grid">
                    <span class="text-sm font-semibold">{{ $t('header.importData') }}</span>
                    <span class="text-muted-foreground text-xs font-normal">{{ $t('header.importDataHint') }}</span>
                  </span>
                </Button>
              </RouterLink>

              <Button
                v-if="!userStore.isDemo"
                variant="ghost"
                class="h-auto w-full justify-start gap-3 p-2 text-left"
                @click="openAttachInvoice"
              >
                <span
                  class="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-md"
                >
                  <ReceiptTextIcon class="size-4" />
                </span>
                <span class="grid">
                  <span class="text-sm font-semibold">{{ $t('header.attachInvoice') }}</span>
                  <span class="text-muted-foreground text-xs font-normal">{{ $t('header.attachInvoiceHint') }}</span>
                </span>
              </Button>
            </Popover.PopoverContent>
          </Popover.Popover>
        </div>

        <AttachInvoiceDialog v-if="isAttachInvoiceMounted" v-model:open="isAttachInvoiceOpen" />
      </div>

      <div class="ml-auto flex items-center gap-2">
        <DesktopOnlyTooltip :content="$t('header.feedback')" :disabled="!isHeaderBarCompact">
          <span class="inline-flex">
            <FeedbackDialog>
              <Button
                variant="secondary"
                :size="isHeaderBarCompact ? 'icon' : 'sm'"
                :class="['flex items-center gap-1.5', { 'feedback-pulse': isFeedbackPulsing }]"
                :aria-label="$t('header.feedback')"
                @mouseenter="onFeedbackEnter"
                @click="onFeedbackClick"
              >
                <FeedbackIcon class="text-primary-text size-4" />
                <span class="hidden @[890px]/header-bar:inline">{{ $t('header.feedback') }}</span>
              </Button>
            </FeedbackDialog>
          </span>
        </DesktopOnlyTooltip>

        <DesktopOnlyTooltip
          v-if="isSupportButtonVisible"
          :content="$t('header.support')"
          :disabled="!isHeaderBarCompact"
        >
          <Button
            variant="secondary"
            :size="isHeaderBarCompact ? 'icon' : 'sm'"
            class="flex items-center gap-1.5"
            :aria-label="$t('header.support')"
            @click="openSupport"
          >
            <HeartIcon class="text-heart size-4 fill-current" />
            <span class="hidden @[890px]/header-bar:inline">{{ $t('header.support') }}</span>
          </Button>
        </DesktopOnlyTooltip>

        <template v-if="accountsNeedingRelink.length > 0">
          <AccountsRelinkWarning />
        </template>
        <template v-else>
          <Popover.Popover v-model:open="isPopoverOpen">
            <Popover.PopoverTrigger as-child>
              <Button variant="secondary" size="icon" :aria-label="syncButtonLabel">
                <RefreshCcw v-if="syncStatus.isSyncing.value" class="animate-spin" :size="16" />
                <AlertTriangleIcon v-else-if="syncStatus.syncStuck.value" class="text-destructive-text" :size="16" />
                <CloudAlertIcon v-else-if="syncStatus.hasSyncIssue.value" class="text-destructive-text size-4" />
                <SparklesIcon
                  v-else-if="categorizationStatus.isCategorizing.value"
                  class="text-primary-text animate-pulse"
                  :size="16"
                />
                <CloudCheckIcon v-else-if="hasConnections" class="text-success-text size-4" />
                <CloudCheckIcon v-else class="size-4" />
              </Button>
            </Popover.PopoverTrigger>
            <Popover.PopoverContent class="w-auto p-0" align="end">
              <SyncStatusTooltip
                :account-statuses="syncStatus.accountStatuses.value"
                :connections-needing-reauth="syncStatus.connectionsNeedingReauth.value"
                :sync-progress="syncStatus.syncProgress.value"
                :last-sync-timestamp="syncStatus.lastSyncTimestamp.value"
                :is-loading="syncStatus.isLoading.value"
                :is-syncing="syncStatus.isSyncing.value"
                :sync-stuck="syncStatus.syncStuck.value"
                :show-success-message="syncStatus.showSuccessMessage.value"
                :categorization-status="categorizationStatus.categorizationStatus.value"
                :is-categorizing="categorizationStatus.isCategorizing.value"
                :categorization-progress="categorizationStatus.progress.value"
                :categorization-just-completed="categorizationStatus.justCompleted.value"
                @trigger-sync="handleSyncClick"
              />
            </Popover.PopoverContent>
          </Popover.Popover>

          <SyncConfirmationDialog
            v-model:open="showConfirmDialog"
            :last-sync-timestamp="syncStatus.lastSyncTimestamp.value"
            @confirm="confirmSync"
          />
        </template>

        <NotificationsPopover />

        <RouterLink :to="{ name: ROUTES_NAMES.settings }">
          <DesktopOnlyTooltip :content="$t('header.settings')">
            <Button variant="secondary" size="icon" :aria-label="$t('header.settings')">
              <SettingsIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AccountsRelinkWarning from '@/components/accounts-relink-warning.vue';
import TrialBanner from '@/components/billing/trial-banner.vue';
import FeedbackIcon from '@/components/common/icons/feedback-icon.vue';
import FeedbackDialog from '@/components/dialogs/feedback-dialog.vue';
import DemoBanner from '@/components/demo/demo-banner.vue';
import ManageTransactionDialog from '@/components/dialogs/manage-transaction/index.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import * as Sheet from '@/components/lib/ui/sheet';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import NotificationsPopover from '@/components/notifications-popover/index.vue';
import Sidebar from '@/components/sidebar/index.vue';
import SyncConfirmationDialog from '@/components/sync-confirmation-dialog.vue';
import SyncStatusTooltip from '@/components/sync-status-tooltip.vue';
import {
  createTransactionPrefill,
  isCreateTransactionDialogOpen,
} from '@/composable/global-state/create-transaction-dialog';
import { isMobileSheetOpen } from '@/composable/global-state/mobile-sheet';
import { useCategorizationStatus } from '@/composable/use-categorization-status';
import { useCssVarFromElementSize } from '@/composable/use-css-var-from-element-size';
import { useDateLocale } from '@/composable/use-date-locale';
import { useFeedbackAttention } from '@/composable/use-feedback-attention';
import { useIdleEnabled } from '@/composable/use-idle-enabled';
import { useSupportButton } from '@/composable/use-support-button';
import { useSyncStatus } from '@/composable/use-sync-status';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useUserStore } from '@/stores';
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CloudAlertIcon,
  CloudCheckIcon,
  HeartIcon,
  ImportIcon,
  MenuIcon,
  PlusIcon,
  ReceiptTextIcon,
  RefreshCcw,
  SettingsIcon,
  SparklesIcon,
} from '@lucide/vue';
import { useResizeObserver } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';

const AttachInvoiceDialog = defineAsyncComponent(() => import('@/components/dialogs/attach-invoice/index.vue'));

const userStore = useUserStore();
const isAddMenuOpen = ref(false);
const isAttachInvoiceMounted = ref(false);
const isAttachInvoiceOpen = ref(false);

const openAttachInvoice = () => {
  isAddMenuOpen.value = false;
  isAttachInvoiceMounted.value = true;
  isAttachInvoiceOpen.value = true;
};

const accountsStore = useAccountsStore();
const { accountsNeedingRelink, isAccountsFetched } = storeToRefs(accountsStore);

const { elementRef: headerRef } = useCssVarFromElementSize({
  cssVars: [{ cssVarName: '--header-height' }],
});

const { t } = useI18n();
const route = useRoute();
const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);
const showConfirmDialog = ref(false);
const isPopoverOpen = ref(false);

const { isPulsing: isFeedbackPulsing, onEnter: onFeedbackEnter, onClick: onFeedbackClick } = useFeedbackAttention();

// Mirror the `@[890px]/header-bar` container query that toggles the feedback
// button's label — tooltip is only useful in the icon-only state.
const headerBarRef = ref<HTMLElement | null>(null);
const isHeaderBarCompact = ref(true);
useResizeObserver(headerBarRef, ([entry]) => {
  if (!entry) return;
  isHeaderBarCompact.value = entry.contentRect.width < 890;
});

const DONATE_URL = 'https://donatr.ee/letehaha';

const { isSupportButtonVisible } = useSupportButton();

const openSupport = () => {
  window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
};

const syncStatus = useSyncStatus();

// AI categorization status
const categorizationStatus = useCategorizationStatus();

// Locale-aware date formatting
const { formatDistanceToNow } = useDateLocale();

const lastSyncRelativeTime = computed(() => {
  if (!syncStatus.lastSyncTimestamp.value) return null;
  return formatDistanceToNow(new Date(syncStatus.lastSyncTimestamp.value), { addSuffix: true });
});

const hasConnections = computed(() => syncStatus.accountStatuses.value.length > 0);

// Sync button is icon-only, so its meaning lives in the accessible name.
const syncButtonLabel = computed(() => {
  if (syncStatus.isSyncing.value) return t('header.sync.syncing');
  if (syncStatus.syncStuck.value) return t('header.sync.stuck');
  if (syncStatus.hasSyncIssue.value) return t('header.sync.failed');
  if (categorizationStatus.isCategorizing.value) return t('header.categorization.categorizing');
  if (hasConnections.value) {
    return lastSyncRelativeTime.value
      ? t('header.sync.syncedTime', { time: lastSyncRelativeTime.value })
      : t('header.sync.synchronizing');
  }
  return t('header.sync.connectBank');
});

// Auto-check sync once accounts have loaded and no connection needs re-linking.
// Watch a derived boolean instead of the `accountsNeedingRelink` array: that
// computed yields a fresh reference on every accounts refetch and would re-fire
// this, whereas a boolean only fires on real transitions. Watching the combined
// flag also re-runs the check when a re-link is later resolved (false → true).
//
// Gated on `idleEnabled` so the auto-check POST + status refetch stay off the
// dashboard's critical path — the manual sync button and initial status query
// are untouched and still run eagerly.
const idleEnabled = useIdleEnabled();
const canAutoSync = computed(() => isAccountsFetched.value && accountsNeedingRelink.value.length === 0);
watch(
  [canAutoSync, idleEnabled],
  async ([ready, idle]) => {
    if (!ready || !idle) return;
    await syncStatus.checkAndAutoSync();
  },
  { immediate: true },
);

const handleSyncClick = async () => {
  // Check if confirmation is needed
  if (syncStatus.needsConfirmation.value) {
    // Close popover and show confirmation dialog
    isPopoverOpen.value = false;
    showConfirmDialog.value = true;
    return;
  }

  // No confirmation needed, trigger sync directly
  await syncStatus.triggerSync(true);
  // Keep popover open to show sync progress
};

const confirmSync = async () => {
  showConfirmDialog.value = false;
  await syncStatus.triggerSync(true); // Skip confirmation
  // Reopen popover to show sync progress
  isPopoverOpen.value = true;
};

watch(route, () => {
  isMobileSheetOpen.value = false;
});
</script>
