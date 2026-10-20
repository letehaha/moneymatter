<script setup lang="ts">
import {
  deleteSubscription,
  linkTransactionsToSubscription,
  loadSubscriptionById,
  loadSuggestedMatches,
  revertSubscriptionPeriod,
  skipSubscriptionPeriod,
  toggleSubscriptionActive,
  unlinkSubscriptionPeriodTransaction,
} from '@/api/subscriptions';
import { loadTransactionById } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import TransactionDetailsModal from '@/components/transactions-list/transaction-details-modal.vue';
import { useManageTransactionDialog } from '@/components/transactions-list/use-manage-transaction-dialog';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { useFormatCurrency } from '@/composable/formatters';
import { ApiErrorResponseError, isNotFoundError } from '@/js/errors';
import { getCurrencyIcon } from '@/js/helpers/currencyImage';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes';
import { useTagsStore } from '@/stores';
import {
  SUBSCRIPTION_PERIOD_STATUSES,
  SUBSCRIPTION_TYPES,
  type SubscriptionPeriodModel,
  type TransactionModel,
} from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useNow } from '@vueuse/core';
import { format, parseISO } from 'date-fns';
import {
  CheckIcon,
  CirclePauseIcon,
  EditIcon,
  EllipsisVerticalIcon,
  LinkIcon,
  RepeatIcon,
  SettingsIcon,
  SkipForwardIcon,
  Trash2Icon,
  UndoIcon,
  UnlinkIcon,
} from '@lucide/vue';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';

import { AUTOMATION_MODES, type AutomationMode, deriveAutomationMode } from './automation-editor-state';
import EditAutomationDialog from './components/edit-automation-dialog.vue';
import EditBasicsDialog from './components/edit-basics-dialog.vue';
import EditOrganizeDialog from './components/edit-organize-dialog.vue';
import EditScheduleDialog from './components/edit-schedule-dialog.vue';
import LinkedTransactionsSection from './components/linked-transactions-section.vue';
import SubscriptionMarkPaidDialog from './components/subscription-mark-paid-dialog.vue';
import SubscriptionTypeBadge from './components/subscription-type-badge.vue';
import { daysUntilDue, hasUpcomingDue } from './subscription-due-status';
import { formatFrequency, getTransactionTypePrefix, getTransactionTypeStyles } from './utils';

const ManageTransactionDialogContent = defineAsyncComponent(
  () => import('@/components/dialogs/manage-transaction/dialog-content.vue'),
);

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const subscriptionId = computed(() => route.params.id as string);

// Single clock for the page, so every "in N days" readout ticks past midnight together.
const now = useNow({ interval: 60_000 });

const tagsStore = useTagsStore();
tagsStore
  .loadTags()
  .catch((error) => captureException({ error, context: { scope: 'subscription-details:load-tags' } }));

const {
  data: subscription,
  isLoading,
  isError,
  error,
} = useQuery({
  queryFn: () => loadSubscriptionById({ id: subscriptionId.value }),
  queryKey: [...VUE_QUERY_CACHE_KEYS.subscriptionDetails, subscriptionId],
  staleTime: Infinity,
  retry: false,
});

const isNotFound = computed(() => isError.value && isNotFoundError(error.value));

watch(
  isError,
  (errored) => {
    if (!errored || isNotFound.value) return;
    addErrorNotification(t('errors.api.unexpectedError'));
    router.replace({ name: ROUTES_NAMES.plannedSubscriptions });
  },
  { immediate: true },
);

const currencyFlagFailed = ref(false);

const isActionsOpen = ref(false);
const isBasicsEditorOpen = ref(false);
const isScheduleEditorOpen = ref(false);
const isAutomationEditorOpen = ref(false);
const isOrganizeEditorOpen = ref(false);
const isDeleteDialogOpen = ref(false);
const isSuggestDialogOpen = ref(false);
const suggestedMatches = ref<TransactionModel[]>([]);
const selectedSuggestionIds = ref<Set<string>>(new Set());
const isSuggestLoading = ref(false);

const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();

// Period actions create/delete/link transactions, so transaction views refresh too.
const invalidateQueries = () => {
  invalidateSubscriptionQueries();
  queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
};

const handleToggleActive = async () => {
  if (!subscription.value) return;
  try {
    await toggleSubscriptionActive({ id: subscriptionId.value, isActive: !subscription.value.isActive });
    invalidateQueries();
  } catch {
    addErrorNotification(t('planned.subscriptions.toggleError'));
  }
};

const handleDelete = async () => {
  try {
    await deleteSubscription({ id: subscriptionId.value });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.subscriptionsList });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.subscriptionsSummary });
    addSuccessNotification(t('planned.subscriptions.deleteSuccess'));
    router.push({ name: ROUTES_NAMES.plannedSubscriptions });
  } catch {
    addErrorNotification(t('planned.subscriptions.deleteError'));
  } finally {
    isDeleteDialogOpen.value = false;
  }
};

const handleSuggestMatches = async () => {
  if (isSuggestLoading.value) return;
  isSuggestLoading.value = true;
  try {
    suggestedMatches.value = await loadSuggestedMatches({ id: subscriptionId.value });
    selectedSuggestionIds.value = new Set();
    isSuggestDialogOpen.value = true;
  } catch {
    addErrorNotification(t('planned.subscriptions.suggestError'));
  } finally {
    isSuggestLoading.value = false;
  }
};

const toggleSuggestionSelection = ({ transactionId }: { transactionId: string }) => {
  const newSet = new Set(selectedSuggestionIds.value);
  if (newSet.has(transactionId)) {
    newSet.delete(transactionId);
  } else {
    newSet.add(transactionId);
  }
  selectedSuggestionIds.value = newSet;
};

const handleLinkSelected = async () => {
  if (selectedSuggestionIds.value.size === 0) return;
  try {
    await linkTransactionsToSubscription({
      id: subscriptionId.value,
      transactionIds: Array.from(selectedSuggestionIds.value),
    });
    invalidateQueries();
    isSuggestDialogOpen.value = false;
    addSuccessNotification(t('planned.subscriptions.linkSuccess'));
  } catch {
    addErrorNotification(t('planned.subscriptions.linkError'));
  }
};

const hasMatchingRules = computed(() => {
  return (subscription.value?.matchingRules?.rules?.length ?? 0) > 0;
});

const KIND_LABEL_KEYS: Record<SUBSCRIPTION_TYPES, string> = {
  [SUBSCRIPTION_TYPES.subscription]: 'planned.subscriptions.typeSubscription',
  [SUBSCRIPTION_TYPES.bill]: 'planned.subscriptions.typeBill',
  [SUBSCRIPTION_TYPES.installment]: 'planned.subscriptions.typeInstallment',
};

const formattedAmount = computed(() => {
  const sub = subscription.value;
  if (!sub?.expectedAmount || !sub.expectedCurrencyCode) return null;
  return `${getTransactionTypePrefix(sub.transactionType)}${formatAmountByCurrencyCode(sub.expectedAmount, sub.expectedCurrencyCode)}`;
});

const remindersSummary = computed(() => {
  const presets = subscription.value?.remindBefore ?? [];
  if (!presets.length) return null;
  return presets.map((preset) => t(`planned.subscriptions.form.remindPresets.${preset}`)).join(', ');
});

const automationMode = computed(() =>
  deriveAutomationMode({
    autoRecord: subscription.value?.autoRecord ?? false,
    rules: subscription.value?.matchingRules?.rules ?? [],
  }),
);

const AUTOMATION_MODE_LABEL_KEYS: Record<AutomationMode, string> = {
  [AUTOMATION_MODES.match]: 'planned.subscriptions.editors.automation.modeMatchLabel',
  [AUTOMATION_MODES.record]: 'planned.subscriptions.editors.automation.modeRecordLabel',
  [AUTOMATION_MODES.manual]: 'planned.subscriptions.editors.automation.modeManualLabel',
};

/** Tag chips render from the store, so an unloaded store degrades to a plain count. */
const resolvedTags = computed(() =>
  (subscription.value?.tagIds ?? []).flatMap((id) => {
    const tag = tagsStore.getTagById(id);
    return tag ? [tag] : [];
  }),
);

const MAX_VISIBLE_TAGS = 2;
const visibleTags = computed(() =>
  resolvedTags.value.length > MAX_VISIBLE_TAGS ? resolvedTags.value.slice(0, 1) : resolvedTags.value,
);
const hiddenTagsCount = computed(() => resolvedTags.value.length - visibleTags.value.length);

const { byId: payeesById } = usePayeeLookup();
const resolvedPayee = computed(() => {
  const payeeId = subscription.value?.payeeId;
  if (!payeeId) return null;
  return payeesById.value.get(payeeId) ?? null;
});

// --- Scheduled payment engine (only for subscriptions that have a dueDate / periods) ---

/**
 * A subscription is "scheduled" when the backend has generated periods for it.
 * This happens only when a dueDate has been set; detection-only subscriptions
 * (no dueDate) will always have an empty periods array.
 */
const isScheduled = computed(() => (subscription.value?.periods?.length ?? 0) > 0);

const periods = computed(() => subscription.value?.periods ?? []);

const isInstallment = computed(() => subscription.value?.type === SUBSCRIPTION_TYPES.installment);

// A finished installment (completedAt set) reads as "Completed", distinct from a
// manually paused subscription. Both carry isActive=false.
const isCompleted = computed(() => subscription.value?.completedAt != null);

/**
 * Paid-vs-total progress for any capped plan (maxOccurrences set). `remaining` is
 * the count still to pay; `remainingTotal` multiplies it by the expected amount
 * (null for variable-amount plans). Null when the plan has no cap.
 */
const installmentProgress = computed(() => {
  const sub = subscription.value;
  if (!sub || sub.maxOccurrences == null) return null;

  const total = sub.maxOccurrences;
  const paid = periods.value.filter((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.paid).length;
  const remaining = Math.max(0, total - paid);
  // A completed installment has consumed its whole schedule (every period paid OR
  // skipped), so the bar is full even when some periods were skipped not paid.
  const percent = isCompleted.value ? 100 : total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const remainingTotal =
    sub.expectedAmount != null && sub.expectedCurrencyCode != null
      ? formatAmountByCurrencyCode(remaining * sub.expectedAmount, sub.expectedCurrencyCode)
      : null;

  return { total, paid, remaining, percent, remainingTotal };
});

/** The earliest upcoming or overdue period – the one the user acts on next. */
const currentPeriod = computed(() => {
  return (
    periods.value.find(
      (p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming || p.status === SUBSCRIPTION_PERIOD_STATUSES.overdue,
    ) ?? null
  );
});

/** A paused or already-ended subscription has no upcoming payment to show or act on. */
const upcomingPeriod = computed(() => {
  const period = currentPeriod.value;
  if (!period || !subscription.value) return null;
  return hasUpcomingDue({ subscription: subscription.value, dueDate: period.dueDate }) ? period : null;
});

function getDaysUntilDue({ dueDate }: { dueDate: string }): number | null {
  return daysUntilDue({ dueDate, now: now.value });
}

/**
 * Status to display for a period. An `upcoming` period whose due date has already
 * passed is shown as `overdue` immediately, without waiting for the daily cron
 * that flips the stored status — so a past due date never reads as "in -1 days".
 */
function effectivePeriodStatus({ period }: { period: SubscriptionPeriodModel }): string {
  const days = getDaysUntilDue({ dueDate: period.dueDate });
  if (period.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming && days !== null && days < 0) {
    return SUBSCRIPTION_PERIOD_STATUSES.overdue;
  }
  return period.status;
}

const currentPeriodStatus = computed(() =>
  currentPeriod.value ? effectivePeriodStatus({ period: currentPeriod.value }) : null,
);

function groupPeriodsByMonth(periodsList: SubscriptionPeriodModel[]) {
  const groups: Record<string, SubscriptionPeriodModel[]> = {};
  for (const p of periodsList) {
    const key = p.dueDate.substring(0, 7); // "YYYY-MM"
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(p);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

const periodGroups = computed(() => groupPeriodsByMonth(periods.value));

function getStatusBadge({ status }: { status: string }): { label: string; class: string } {
  switch (status) {
    case SUBSCRIPTION_PERIOD_STATUSES.paid:
      return {
        label: t('planned.subscriptions.periods.status.paid'),
        class: 'bg-success-text/20 text-success-text',
      };
    case SUBSCRIPTION_PERIOD_STATUSES.overdue:
      return {
        label: t('planned.subscriptions.periods.status.overdue'),
        class: 'bg-destructive/10 text-destructive-text',
      };
    case SUBSCRIPTION_PERIOD_STATUSES.skipped:
      return {
        label: t('planned.subscriptions.periods.status.skipped'),
        class: 'bg-muted text-muted-foreground',
      };
    case SUBSCRIPTION_PERIOD_STATUSES.upcoming:
      return {
        label: t('planned.subscriptions.periods.status.upcoming'),
        class: 'border border-border text-foreground',
      };
    default:
      return { label: status, class: 'border border-border text-foreground' };
  }
}

function isStatusActionable({ status }: { status: string }): boolean {
  return status === SUBSCRIPTION_PERIOD_STATUSES.upcoming || status === SUBSCRIPTION_PERIOD_STATUSES.overdue;
}

function isStatusRevertable({ status }: { status: string }): boolean {
  return status === SUBSCRIPTION_PERIOD_STATUSES.paid || status === SUBSCRIPTION_PERIOD_STATUSES.skipped;
}

// Mark paid dialog
const markPaidRef = ref<InstanceType<typeof SubscriptionMarkPaidDialog>>();
const isMarkingPaid = computed(() => markPaidRef.value?.isPending ?? false);

function payPeriod({ periodId }: { periodId: string }) {
  if (!subscription.value) return;
  markPaidRef.value?.triggerPay({ subscription: subscription.value, periodId });
}

// Skip period
const { mutate: skipMutation, isPending: isSkipping } = useMutation({
  mutationFn: skipSubscriptionPeriod,
  onSuccess: () => {
    invalidateQueries();
    addSuccessNotification(t('planned.subscriptions.periods.notifications.periodSkipped'));
  },
  onError(err) {
    const message =
      err instanceof ApiErrorResponseError
        ? err.data.message
        : t('planned.subscriptions.periods.notifications.skipFailed');
    addErrorNotification(message ?? t('planned.subscriptions.periods.notifications.skipFailed'));
  },
});

// Unlink period transaction
const { mutate: unlinkPeriodMutation, isPending: isUnlinkingPeriod } = useMutation({
  mutationFn: unlinkSubscriptionPeriodTransaction,
  onSuccess: () => {
    invalidateQueries();
    addSuccessNotification(t('planned.subscriptions.periods.notifications.transactionUnlinked'));
  },
  onError(err) {
    const message =
      err instanceof ApiErrorResponseError
        ? err.data.message
        : t('planned.subscriptions.periods.notifications.unlinkFailed');
    addErrorNotification(message ?? t('planned.subscriptions.periods.notifications.unlinkFailed'));
  },
});

// Revert period
const revertTarget = ref<SubscriptionPeriodModel | null>(null);
const { mutate: revertMutation, isPending: isReverting } = useMutation({
  mutationFn: revertSubscriptionPeriod,
  onSuccess: () => {
    invalidateQueries();
    revertTarget.value = null;
    addSuccessNotification(t('planned.subscriptions.periods.notifications.periodReverted'));
  },
  onError(err) {
    const message =
      err instanceof ApiErrorResponseError
        ? err.data.message
        : t('planned.subscriptions.periods.notifications.revertFailed');
    addErrorNotification(message ?? t('planned.subscriptions.periods.notifications.revertFailed'));
  },
});

/**
 * Reverting behaves differently depending on the period's transaction link:
 * - App-generated transaction → deleted (balance restored)
 * - User-linked transaction → only detached
 * - No transaction → period simply returns to unpaid
 */
const revertDescriptionKey = computed(() => {
  const period = revertTarget.value;
  if (period?.transactionId && period.transactionAutoCreated) {
    return 'planned.subscriptions.periods.dialogs.revertDescriptionDeletesTransaction';
  }
  if (period?.transactionId) {
    return 'planned.subscriptions.periods.dialogs.revertDescriptionUnlinksTransaction';
  }
  return 'planned.subscriptions.periods.dialogs.revertDescription';
});

const isPeriodActionPending = computed(
  () => isMarkingPaid.value || isSkipping.value || isUnlinkingPeriod.value || isReverting.value,
);

// Open the transaction linked to a period in the canonical manage-transaction dialog.
const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);
const { isDialogVisible, dialogProps, isCompactDialog, handleRecordClick, closeDialog } = useManageTransactionDialog();
const isOpeningTransaction = ref(false);

async function openTransaction({ transactionId }: { transactionId: string }) {
  if (isOpeningTransaction.value) return;
  isOpeningTransaction.value = true;
  try {
    const tx = await loadTransactionById({ id: transactionId });
    if (tx) {
      handleRecordClick([tx, undefined]);
    } else {
      addErrorNotification(t('planned.subscriptions.periods.notifications.transactionLoadFailed'));
    }
  } catch {
    addErrorNotification(t('planned.subscriptions.periods.notifications.transactionLoadFailed'));
  } finally {
    isOpeningTransaction.value = false;
  }
}
</script>

<template>
  <ResourceNotFound
    v-if="isNotFound"
    :title="t('planned.subscriptions.notFound')"
    :description="t('planned.subscriptions.notFoundDescription')"
    :link-label="t('planned.subscriptions.backToList')"
    :link-to="{ name: ROUTES_NAMES.plannedSubscriptions }"
  />

  <!-- Loading -->
  <div v-else-if="isLoading" class="mr-auto w-full max-w-5xl animate-pulse">
    <div class="bg-muted mb-4 h-8 w-1/3 rounded" />
    <div class="bg-muted mb-2 h-5 w-2/3 rounded" />
    <div class="bg-muted mb-6 h-5 w-1/2 rounded" />
    <div class="bg-muted h-40 rounded-lg" />
  </div>

  <div v-else-if="subscription" class="mr-auto w-full max-w-5xl">
    <!-- Header -->
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-3">
          <BrandLogo v-bind="toEntityLogoDisplayProps(subscription)" :name="subscription.name" class="size-10" />
          <h1 class="text-2xl font-semibold tracking-tight">{{ subscription.name }}</h1>
          <SubscriptionTypeBadge :type="subscription.type" size="md" />
          <span
            v-if="isCompleted"
            class="bg-success-text/10 text-success-text inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
          >
            <CheckIcon class="size-3" />
            {{ $t('planned.subscriptions.completed') }}
          </span>
          <span
            v-else-if="!subscription.isActive"
            class="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
          >
            <CirclePauseIcon class="size-3" />
            {{ $t('planned.subscriptions.paused') }}
          </span>
        </div>
        <p v-if="subscription.notes" class="text-muted-foreground mt-1 text-sm">{{ subscription.notes }}</p>
      </div>

      <!-- Desktop actions -->
      <div class="hidden items-center gap-2 lg:flex">
        <Button v-if="!isCompleted" variant="outline" size="sm" @click="handleToggleActive">
          <CirclePauseIcon v-if="subscription.isActive" class="size-4" />
          <RepeatIcon v-else class="size-4" />
          {{
            subscription.isActive
              ? $t('planned.subscriptions.pauseSubscription')
              : $t('planned.subscriptions.resumeSubscription')
          }}
        </Button>
        <Button variant="destructive" size="sm" @click="isDeleteDialogOpen = true">
          <Trash2Icon class="size-4" />
          {{ $t('planned.subscriptions.deleteSubscription') }}
        </Button>
      </div>

      <!-- Mobile/tablet actions dropdown -->
      <Popover v-model:open="isActionsOpen">
        <PopoverTrigger as-child class="lg:hidden">
          <Button variant="outline" size="icon-sm">
            <EllipsisVerticalIcon class="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="flex w-auto min-w-48 flex-col gap-1 p-1">
          <Button
            v-if="!isCompleted"
            variant="ghost"
            size="sm"
            class="w-full justify-start"
            @click="
              isActionsOpen = false;
              handleToggleActive();
            "
          >
            <CirclePauseIcon v-if="subscription.isActive" class="size-4" />
            <RepeatIcon v-else class="size-4" />
            {{
              subscription.isActive
                ? $t('planned.subscriptions.pauseSubscription')
                : $t('planned.subscriptions.resumeSubscription')
            }}
          </Button>
          <Button
            variant="ghost-destructive"
            size="sm"
            class="w-full justify-start"
            @click="
              isActionsOpen = false;
              isDeleteDialogOpen = true;
            "
          >
            <Trash2Icon class="size-4" />
            {{ $t('planned.subscriptions.deleteSubscription') }}
          </Button>
        </PopoverContent>
      </Popover>
    </div>

    <!-- Summary cards: each one is a read-only digest of the slice its editor owns. -->
    <div class="@container mb-6">
      <div class="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <div class="bg-card rounded-lg border p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-muted-foreground text-xs font-medium uppercase">
              {{ $t('planned.subscriptions.editors.basics.title') }}
            </p>
            <DesktopOnlyTooltip :content="$t('planned.subscriptions.editors.basics.edit')">
              <Button variant="ghost" size="icon-sm" @click="isBasicsEditorOpen = true">
                <EditIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
          <dl class="grid gap-1.5 text-sm">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.amount') }}</dt>
              <dd class="text-right font-medium" :class="getTransactionTypeStyles(subscription.transactionType, '')">
                {{ formattedAmount ?? '–' }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.typeLabel') }}</dt>
              <dd class="text-right font-medium">{{ $t(KIND_LABEL_KEYS[subscription.type]) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.currencyLabel') }}</dt>
              <dd class="flex items-center gap-1.5 text-right font-medium">
                <template v-if="subscription.expectedCurrencyCode">
                  <img
                    v-if="!currencyFlagFailed"
                    :src="getCurrencyIcon(subscription.expectedCurrencyCode)"
                    :alt="subscription.expectedCurrencyCode"
                    class="size-3.5 shrink-0 rounded-[2px]"
                    loading="lazy"
                    @error="currencyFlagFailed = true"
                  />
                  {{ subscription.expectedCurrencyCode }}
                </template>
                <template v-else>–</template>
              </dd>
            </div>
          </dl>
        </div>

        <div class="bg-card rounded-lg border p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-muted-foreground text-xs font-medium uppercase">
              {{ $t('planned.subscriptions.editors.schedule.title') }}
            </p>
            <DesktopOnlyTooltip :content="$t('planned.subscriptions.editors.schedule.edit')">
              <Button variant="ghost" size="icon-sm" @click="isScheduleEditorOpen = true">
                <EditIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
          <dl class="grid gap-1.5 text-sm">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.frequencyLabel') }}</dt>
              <dd class="text-right font-medium">{{ formatFrequency({ frequency: subscription.frequency, t }) }}</dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.nextExpected') }}</dt>
              <dd class="text-right font-medium">
                {{
                  subscription.nextExpectedDate ? format(parseISO(subscription.nextExpectedDate), 'MMM d, yyyy') : '–'
                }}
              </dd>
            </div>
            <div v-if="subscription.endDate" class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.endDateLabel') }}</dt>
              <dd class="text-right font-medium">{{ format(parseISO(subscription.endDate), 'MMM d, yyyy') }}</dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.remindBeforeLabel') }}</dt>
              <dd class="text-right font-medium">{{ remindersSummary ?? '–' }}</dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.notifyEmailLabel') }}</dt>
              <dd class="text-right font-medium">
                {{
                  subscription.notifyEmail
                    ? $t('planned.subscriptions.editors.schedule.emailOn')
                    : $t('planned.subscriptions.editors.schedule.emailOff')
                }}
              </dd>
            </div>
          </dl>
        </div>

        <div class="bg-card rounded-lg border p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-muted-foreground text-xs font-medium uppercase">
              {{ $t('planned.subscriptions.editors.automation.title') }}
            </p>
            <DesktopOnlyTooltip :content="$t('planned.subscriptions.editors.automation.edit')">
              <Button variant="ghost" size="icon-sm" @click="isAutomationEditorOpen = true">
                <EditIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
          <p class="text-sm font-medium">{{ $t(AUTOMATION_MODE_LABEL_KEYS[automationMode]) }}</p>
          <p class="text-muted-foreground mt-0.5 text-sm">
            <template v-if="automationMode === AUTOMATION_MODES.match">
              {{ $t('planned.subscriptions.form.rulesCount', { count: subscription.matchingRules.rules.length }) }}
            </template>
            <template v-else-if="automationMode === AUTOMATION_MODES.record">
              {{
                subscription.account
                  ? $t('planned.subscriptions.editors.automation.summaryRecord', { account: subscription.account.name })
                  : $t('planned.subscriptions.editors.automation.summaryRecordNoAccount')
              }}
            </template>
            <template v-else>
              {{ $t('planned.subscriptions.editors.automation.summaryManual') }}
            </template>
          </p>
          <p v-if="subscription.account" class="text-muted-foreground mt-1.5 text-sm">
            {{ $t('planned.subscriptions.form.accountLabel') }}:
            <span class="text-foreground font-medium">
              {{ subscription.account.name }} ({{ subscription.account.currencyCode }})
            </span>
          </p>
        </div>

        <div class="bg-card rounded-lg border p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-muted-foreground text-xs font-medium uppercase">
              {{ $t('planned.subscriptions.editors.organize.title') }}
            </p>
            <DesktopOnlyTooltip :content="$t('planned.subscriptions.editors.organize.edit')">
              <Button variant="ghost" size="icon-sm" @click="isOrganizeEditorOpen = true">
                <EditIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
          <dl class="grid gap-1.5 text-sm">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.categoryLabel') }}</dt>
              <dd class="flex items-center gap-1.5 text-right font-medium">
                <template v-if="subscription.category">
                  <span
                    class="inline-block size-2.5 shrink-0 rounded-full"
                    :style="{ backgroundColor: subscription.category.color }"
                  />
                  {{ subscription.category.name }}
                </template>
                <template v-else>–</template>
              </dd>
            </div>
            <div v-if="subscription.payeeId" class="flex items-center justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.payeeLabel') }}</dt>
              <dd class="flex items-center gap-1.5 text-right font-medium">
                <template v-if="resolvedPayee">
                  <BrandLogo
                    v-bind="toEntityLogoDisplayProps(resolvedPayee)"
                    :name="resolvedPayee.name"
                    class="size-5 shrink-0"
                  />
                  {{ resolvedPayee.name }}
                </template>
                <template v-else>–</template>
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.tagsLabel') }}</dt>
              <dd class="flex flex-wrap justify-end gap-1 text-right font-medium">
                <template v-if="resolvedTags.length">
                  <span
                    v-for="tag in visibleTags"
                    :key="tag.id"
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white/90"
                    :style="{ backgroundColor: tag.color }"
                  >
                    {{ tag.name }}
                  </span>
                  <span
                    v-if="hiddenTagsCount > 0"
                    class="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  >
                    {{ $t('planned.subscriptions.editors.organize.tagsMore', { count: hiddenTagsCount }) }}
                  </span>
                </template>
                <template v-else-if="subscription.tagIds?.length">
                  {{ subscription.tagIds.length }}
                </template>
                <template v-else>–</template>
              </dd>
            </div>
            <div v-if="subscription.notes" class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('planned.subscriptions.form.notesLabel') }}</dt>
              <dd class="text-right font-medium">
                {{ $t('planned.subscriptions.editors.organize.notesAdded') }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <!-- Installment / capped-plan progress -->
    <div v-if="installmentProgress" class="border-border mb-6 rounded-lg border p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-muted-foreground text-xs font-medium uppercase">
          {{
            isInstallment
              ? $t('planned.subscriptions.progress.title')
              : $t('planned.subscriptions.progress.titleGeneric')
          }}
        </p>
        <p class="text-sm font-medium">
          {{
            $t('planned.subscriptions.progress.paidOfTotal', {
              paid: installmentProgress.paid,
              total: installmentProgress.total,
            })
          }}
        </p>
      </div>
      <div class="bg-muted mt-2 h-2 w-full overflow-hidden rounded-full">
        <div
          class="h-full rounded-full transition-all"
          :class="isCompleted ? 'bg-success-text' : 'bg-primary'"
          :style="{ width: `${installmentProgress.percent}%` }"
        />
      </div>
      <div class="text-muted-foreground mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span v-if="isCompleted">{{ $t('planned.subscriptions.progress.completedNote') }}</span>
        <span v-else>{{
          $t('planned.subscriptions.progress.remaining', { count: installmentProgress.remaining })
        }}</span>
        <span v-if="installmentProgress.remainingTotal && !isCompleted">
          {{ $t('planned.subscriptions.progress.remainingTotal', { amount: installmentProgress.remainingTotal }) }}
        </span>
      </div>
    </div>

    <!-- Next Due (scheduled subscriptions only) -->
    <div v-if="isScheduled && upcomingPeriod" class="bg-card mb-6 rounded-lg border p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-muted-foreground text-xs font-medium uppercase">
            {{ $t('planned.subscriptions.periods.nextDue') }}
          </p>
          <p class="mt-0.5 text-sm font-medium">
            {{ format(parseISO(upcomingPeriod.dueDate), 'MMM d, yyyy') }}
          </p>
          <p
            :class="[
              'text-xs',
              currentPeriodStatus === SUBSCRIPTION_PERIOD_STATUSES.overdue
                ? 'text-destructive-text'
                : 'text-muted-foreground',
            ]"
          >
            <template v-if="currentPeriodStatus === SUBSCRIPTION_PERIOD_STATUSES.overdue">
              {{ $t('planned.subscriptions.periods.overdueBadge') }}
            </template>
            <template v-else-if="getDaysUntilDue({ dueDate: upcomingPeriod.dueDate }) !== null">
              {{
                $t('planned.subscriptions.periods.inDays', {
                  count: getDaysUntilDue({ dueDate: upcomingPeriod.dueDate })!,
                })
              }}
            </template>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <DesktopOnlyTooltip :content="$t('planned.subscriptions.periods.tooltips.skip')">
            <Button
              variant="ghost"
              size="sm"
              :disabled="isPeriodActionPending"
              @click="skipMutation({ id: subscription.id, periodId: upcomingPeriod.id })"
            >
              <SkipForwardIcon class="size-4" />
              {{ $t('planned.subscriptions.periods.actions.skip') }}
            </Button>
          </DesktopOnlyTooltip>
          <Button
            variant="soft-success"
            size="sm"
            :disabled="isPeriodActionPending"
            @click="payPeriod({ periodId: upcomingPeriod.id })"
          >
            <CheckIcon class="size-4" />
            {{ $t('planned.subscriptions.periods.actions.markPaid') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Payment History (scheduled subscriptions only) -->
    <template v-if="isScheduled">
      <div class="mb-4">
        <h2 class="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
          {{ $t('planned.subscriptions.periods.paymentHistory') }}
        </h2>

        <div v-if="!periods.length" class="text-muted-foreground py-8 text-center text-sm">
          {{ $t('planned.subscriptions.periods.noPaymentPeriods') }}
        </div>

        <div v-for="[monthKey, monthPeriods] in periodGroups" :key="monthKey" class="mb-4">
          <h3 class="text-muted-foreground mb-2 text-xs font-medium">
            {{ format(parseISO(monthKey + '-01'), 'MMMM yyyy') }}
          </h3>
          <div class="grid gap-2">
            <div
              v-for="period in monthPeriods"
              :key="period.id"
              class="bg-card flex items-center justify-between rounded-lg border p-3"
            >
              <div class="flex items-center gap-3">
                <span
                  :class="[
                    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                    getStatusBadge({ status: effectivePeriodStatus({ period }) }).class,
                  ]"
                >
                  {{ getStatusBadge({ status: effectivePeriodStatus({ period }) }).label }}
                </span>
                <div>
                  <p class="text-sm font-medium">
                    {{ $t('planned.subscriptions.periods.dueOn', { date: period.dueDate }) }}
                  </p>
                  <p v-if="period.paidAt" class="text-muted-foreground text-xs">
                    {{ $t('planned.subscriptions.periods.paidAt', { date: format(new Date(period.paidAt), 'PP') }) }}
                  </p>
                  <Button
                    v-if="period.transactionId"
                    type="button"
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-xs"
                    :disabled="isOpeningTransaction"
                    @click="openTransaction({ transactionId: period.transactionId })"
                  >
                    <LinkIcon class="size-3" />
                    {{ $t('planned.subscriptions.periods.viewTransaction') }}
                  </Button>
                  <p v-if="period.notes" class="text-muted-foreground text-xs italic">
                    {{ period.notes }}
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-1">
                <DesktopOnlyTooltip
                  v-if="isStatusActionable({ status: period.status })"
                  :content="$t('planned.subscriptions.periods.tooltips.markAsPaid')"
                >
                  <Button
                    variant="soft-success"
                    size="sm"
                    :disabled="isPeriodActionPending"
                    @click="payPeriod({ periodId: period.id })"
                  >
                    <CheckIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
                <DesktopOnlyTooltip
                  v-if="isStatusActionable({ status: period.status })"
                  :content="$t('planned.subscriptions.periods.tooltips.skip')"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="isPeriodActionPending"
                    @click="skipMutation({ id: subscription.id, periodId: period.id })"
                  >
                    <SkipForwardIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
                <DesktopOnlyTooltip
                  v-if="period.transactionId"
                  :content="$t('planned.subscriptions.periods.tooltips.unlinkTransaction')"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="isPeriodActionPending"
                    @click="unlinkPeriodMutation({ id: subscription.id, periodId: period.id })"
                  >
                    <UnlinkIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
                <DesktopOnlyTooltip
                  v-if="isStatusRevertable({ status: period.status })"
                  :content="$t('planned.subscriptions.periods.tooltips.revert')"
                >
                  <Button variant="ghost" size="sm" :disabled="isPeriodActionPending" @click="revertTarget = period">
                    <UndoIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <LinkedTransactionsSection
      :subscription="subscription"
      @suggest-matches="handleSuggestMatches"
      @open-automation="isAutomationEditorOpen = true"
    />

    <!-- Focused editors: each one owns and sends only its own field slice. -->
    <EditBasicsDialog v-model:open="isBasicsEditorOpen" :subscription="subscription" />
    <EditScheduleDialog v-model:open="isScheduleEditorOpen" :subscription="subscription" />
    <EditAutomationDialog v-model:open="isAutomationEditorOpen" :subscription="subscription" />
    <EditOrganizeDialog v-model:open="isOrganizeEditorOpen" :subscription="subscription" />

    <!-- Delete Confirmation -->
    <ResponsiveAlertDialog
      v-model:open="isDeleteDialogOpen"
      confirm-variant="destructive"
      :confirm-label="$t('planned.subscriptions.deleteConfirm')"
      @confirm="handleDelete"
      @cancel="isDeleteDialogOpen = false"
    >
      <template #title>{{ $t('planned.subscriptions.deleteConfirmTitle') }}</template>
      <template #description>{{ $t('planned.subscriptions.deleteConfirmDescription') }}</template>
    </ResponsiveAlertDialog>

    <!-- Suggest Matches Dialog -->
    <ResponsiveDialog v-model:open="isSuggestDialogOpen" dialog-content-class="max-w-2xl max-h-[80vh]">
      <template #title>{{ $t('planned.subscriptions.suggestMatchesTitle') }}</template>
      <template #description>{{ $t('planned.subscriptions.suggestMatchesDescription') }}</template>

      <div v-if="suggestedMatches.length" class="max-h-[50vh] overflow-y-auto">
        <div class="divide-border divide-y">
          <TransactionRecord
            v-for="(tx, i) in suggestedMatches"
            :key="tx.id"
            :tx="tx"
            :as-button="false"
            show-checkbox
            :is-selected="selectedSuggestionIds.has(tx.id)"
            :index="i"
            @selection-change="({ id }) => toggleSuggestionSelection({ transactionId: id })"
            @record-click="() => toggleSuggestionSelection({ transactionId: tx.id })"
          />
        </div>
      </div>

      <div v-else class="py-8 text-center">
        <p class="text-muted-foreground text-sm">{{ $t('planned.subscriptions.noSuggestedMatches') }}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="mt-3"
          @click="
            isSuggestDialogOpen = false;
            isAutomationEditorOpen = true;
          "
        >
          <SettingsIcon class="size-4" />
          {{
            hasMatchingRules
              ? $t('planned.subscriptions.updateMatchingRules')
              : $t('planned.subscriptions.addMatchingRules')
          }}
        </Button>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="isSuggestDialogOpen = false">
            {{ $t('planned.subscriptions.cancel') }}
          </Button>
          <Button :disabled="selectedSuggestionIds.size === 0" @click="handleLinkSelected">
            <LinkIcon class="size-4" />
            {{ $t('planned.subscriptions.linkSelected', { count: selectedSuggestionIds.size }) }}
          </Button>
        </div>
      </template>
    </ResponsiveDialog>

    <!-- Revert period confirmation -->
    <ResponsiveAlertDialog
      :open="!!revertTarget"
      :confirm-label="$t('planned.subscriptions.periods.dialogs.revertConfirm')"
      confirm-variant="default"
      @update:open="
        (val: boolean) => {
          if (!val) revertTarget = null;
        }
      "
      @confirm="revertTarget && revertMutation({ id: subscription.id, periodId: revertTarget.id })"
      @cancel="revertTarget = null"
    >
      <template #title>{{ $t('planned.subscriptions.periods.dialogs.revertTitle') }}</template>
      <template #description>
        {{ $t(revertDescriptionKey, { date: revertTarget?.dueDate }) }}
      </template>
    </ResponsiveAlertDialog>

    <!-- Mark-paid flow (decides instant vs. amount dialog internally) -->
    <SubscriptionMarkPaidDialog ref="markPaidRef" @paid="invalidateQueries" />

    <!-- Linked-transaction detail dialog -->
    <TransactionDetailsModal v-model:open="isDialogVisible" :mobile="isMobileView" :is-compact="isCompactDialog">
      <ManageTransactionDialogContent v-bind="dialogProps" @close-modal="closeDialog" />
    </TransactionDetailsModal>
  </div>
</template>
