<script setup lang="ts">
import { type SubscriptionListItem } from '@/api/subscriptions';
import { editTransaction } from '@/api/transactions';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { isPlanMatchWindowExpired, planExpiredDays } from '@/common/utils/planned-transactions';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import TransactionDetailsModal from '@/components/transactions-list/transaction-details-modal.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useDeleteTransaction } from '@/components/dialogs/manage-transaction/composables/use-delete-transaction';
import { PENDING_PLANNED_LIMIT, usePendingPlannedTransactions } from '@/composable/data-queries/planned-transactions';
import { useSubscriptionsList } from '@/composable/data-queries/subscriptions';
import { useDateLocale } from '@/composable/use-date-locale';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { formatUIAmount } from '@/js/helpers';
import SubscriptionMarkPaidDialog from '@/pages/planned/subscriptions/components/subscription-mark-paid-dialog.vue';
import { useCategoriesStore } from '@/stores';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { ACCOUNT_TYPES, TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import { addDays, isBefore, isFuture, parseISO, startOfDay } from 'date-fns';
import { AlertCircleIcon, CalendarClockIcon, CircleCheckIcon, EyeOffIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, defineAsyncComponent, ref } from 'vue';
import { useI18n } from 'vue-i18n';

/** Payments due within this many days (inclusive) count as upcoming. */
const UPCOMING_DAYS_WINDOW = 3;
/** Pending plans shown inline before the card collapses the rest into a counter. */
const MAX_VISIBLE_PLANS = 5;

const ManageTransactionDialogContent = defineAsyncComponent(
  () => import('@/components/dialogs/manage-transaction/dialog-content.vue'),
);

const emit = defineEmits<{
  'toggle-hide': [];
}>();

const { t } = useI18n();
const { format: formatDate } = useDateLocale();
const { categoriesMap } = storeToRefs(useCategoriesStore());
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const markPaidDialogRef = ref<InstanceType<typeof SubscriptionMarkPaidDialog> | null>(null);

// Use the subscriptions list rather than the upcoming-payments endpoint because
// SubscriptionListItem includes currentPeriod.id, which SubscriptionMarkPaidDialog
// requires. Client-side filtering mirrors what the upcoming endpoint would return.
const { data: allSubscriptions, isLoading: isLoadingSubscriptions } = useSubscriptionsList({
  filter: { isActive: true },
  staleTime: 60_000,
});

const {
  plans: pendingPlans,
  isPending: isPlansPending,
  isError: isPlansError,
  refetch: refetchPlans,
} = usePendingPlannedTransactions();

const isLoading = computed(() => isLoadingSubscriptions.value || isPlansPending.value);

/**
 * Returns all actionable subscriptions sorted overdue-first, then by dueDate ASC.
 * Overdue: currentPeriod.dueDate is before today's start.
 * Upcoming: currentPeriod.dueDate is within [today, today + 3 days].
 */
const relevantSubscriptions = computed((): SubscriptionListItem[] => {
  const items = allSubscriptions.value ?? [];
  const now = new Date();
  const todayStart = startOfDay(now);
  const cutoff = addDays(todayStart, UPCOMING_DAYS_WINDOW + 1);

  return items
    .filter((sub) => {
      const dueDate = sub.currentPeriod?.dueDate;
      if (!dueDate) return false;
      const date = parseISO(dueDate);
      // Overdue (before today start) OR upcoming within the window (before cutoff)
      return isBefore(date, cutoff);
    })
    .sort((a, b) => {
      const aDate = parseISO(a.currentPeriod!.dueDate);
      const bDate = parseISO(b.currentPeriod!.dueDate);
      const aOverdue = isBefore(aDate, todayStart);
      const bOverdue = isBefore(bDate, todayStart);
      // Overdue rows first; within the same bucket sort by dueDate ascending.
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return aDate.getTime() - bDate.getTime();
    });
});

const visiblePlans = computed(() => pendingPlans.value.slice(0, MAX_VISIBLE_PLANS));
const hiddenPlansCount = computed(() => Math.max(0, pendingPlans.value.length - visiblePlans.value.length));
// A full page means the backlog runs past what was fetched, so the hidden count is only a floor.
const isHiddenPlansCountPartial = computed(() => pendingPlans.value.length >= PENDING_PLANNED_LIMIT);

// A failed plans fetch still earns the card: the inline error row is the only place the
// user can retry it, and the subscriptions below it are unaffected.
const hasContent = computed(
  () => relevantSubscriptions.value.length > 0 || pendingPlans.value.length > 0 || isPlansError.value,
);

function isOverdue(dateStr: string): boolean {
  return isBefore(parseISO(dateStr), startOfDay(new Date()));
}

function planTitle({ plan }: { plan: TransactionModel }): string {
  const note = plan.note?.trim();
  if (note) return note;
  return categoriesMap.value[plan.categoryId]?.name ?? t('common.ui.other');
}

function planDate({ plan }: { plan: TransactionModel }): string {
  return formatDate(new Date(plan.time), 'd MMM');
}

function planAmount({ plan }: { plan: TransactionModel }): string {
  const signed = plan.transactionType === TRANSACTION_TYPES.expense ? -plan.amount : plan.amount;
  return formatUIAmount(signed, { currency: plan.currencyCode });
}

function isPlanUnconfirmed({ plan }: { plan: TransactionModel }): boolean {
  return isPlanMatchWindowExpired({ time: plan.time });
}

function planUnconfirmedTooltip({ plan }: { plan: TransactionModel }): string {
  return t('transactions.planned.expiredTooltip', {
    days: planExpiredDays({ time: plan.time }),
  });
}

function handleMarkPaid(sub: SubscriptionListItem) {
  if (!sub.currentPeriod) return;

  markPaidDialogRef.value?.triggerPay({
    subscription: {
      id: sub.id,
      name: sub.name,
      expectedAmount: sub.expectedAmount ?? null,
      expectedCurrencyCode: sub.expectedCurrencyCode ?? null,
      accountId: sub.accountId ?? null,
    },
    periodId: sub.currentPeriod.id,
  });
}

const editedPlan = ref<TransactionModel | undefined>(undefined);
const isEditDialogOpen = ref(false);

function handleEditPlan({ plan }: { plan: TransactionModel }) {
  editedPlan.value = plan;
  isEditDialogOpen.value = true;
}

// The bank confirms plans on connected accounts (or the user deletes them); only a
// manual-account plan needs a hand-confirm once the money actually moved.
function canConfirmPlan({ plan }: { plan: TransactionModel }): boolean {
  return plan.accountType === ACCOUNT_TYPES.system;
}

const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const confirmPlanMutation = useMutation({
  mutationFn: ({ plan }: { plan: TransactionModel }) =>
    editTransaction({
      txId: plan.id,
      isPlanned: false,
      // A confirmed plan is money that already moved, so a still-future date has to come back to now.
      ...(isFuture(new Date(plan.time)) ? { time: new Date().toISOString() } : {}),
    }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
    addSuccessNotification(t('records.upcomingSection.confirmPlanSuccess'));
  },
  onError: () => {
    addErrorNotification(t('records.upcomingSection.confirmPlanError'));
  },
});

const deletedPlanId = ref<string | null>(null);
const isDeleteDialogOpen = ref(false);

const deletePlanMutation = useDeleteTransaction({
  onSuccess: () => {
    isDeleteDialogOpen.value = false;
    deletedPlanId.value = null;
  },
});

function handleDeletePlan({ plan }: { plan: TransactionModel }) {
  deletedPlanId.value = plan.id;
  isDeleteDialogOpen.value = true;
}

function confirmDeletePlan() {
  if (!deletedPlanId.value) return;
  deletePlanMutation.mutate({ transactionId: deletedPlanId.value });
}
</script>

<template>
  <div v-if="!isLoading && hasContent" class="@container/upcoming shrink-0">
    <div class="bg-card flex flex-col gap-3 rounded-xl border px-4 py-3">
      <!-- Header row -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <CalendarClockIcon class="text-muted-foreground size-4 shrink-0" />
          <span class="text-sm font-medium">{{ $t('records.upcomingSection.title') }}</span>
        </div>
        <DesktopOnlyTooltip :content="$t('records.upcomingSection.hideToggle')">
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="$t('records.upcomingSection.hideToggle')"
            @click="emit('toggle-hide')"
          >
            <EyeOffIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>

      <!-- One row per actionable subscription (overdue first, then upcoming by dueDate ASC) -->
      <div v-for="sub in relevantSubscriptions" :key="sub.id" class="flex min-w-0 items-center gap-3">
        <BrandLogo v-bind="toEntityLogoDisplayProps(sub)" :name="sub.name" class="size-7 shrink-0" />

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm leading-tight font-medium">{{ sub.name }}</span>
          <div class="flex items-center gap-1.5">
            <span
              v-if="sub.currentPeriod && isOverdue(sub.currentPeriod.dueDate)"
              class="bg-destructive/10 text-destructive-text inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none font-medium"
            >
              <AlertCircleIcon class="size-3" />
              {{ $t('records.upcomingSection.overdueBadge') }}
            </span>
            <span
              v-else
              class="text-muted-foreground bg-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none font-medium"
            >
              {{ $t('records.upcomingSection.scheduledBadge') }}
            </span>
            <span v-if="sub.expectedAmount != null" class="text-muted-foreground text-xs">
              {{ sub.expectedCurrencyCode }} {{ sub.expectedAmount.toLocaleString() }}
            </span>
          </div>
        </div>

        <Button variant="outline" size="sm" class="shrink-0" @click="handleMarkPaid(sub)">
          {{ $t('records.upcomingSection.payAction') }}
        </Button>
      </div>

      <div v-if="isPlansError" class="flex min-w-0 items-center justify-between gap-3">
        <span class="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <AlertCircleIcon class="size-3.5 shrink-0" />
          <span class="truncate">{{ $t('records.upcomingSection.plansLoadFailed') }}</span>
        </span>
        <Button variant="outline" size="sm" class="shrink-0" @click="refetchPlans()">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>

      <!-- Pending plans: money the user expects to move, not a bill to pay -->
      <div v-for="plan in visiblePlans" :key="plan.id" class="flex min-w-0 items-center gap-3">
        <CategoryCircle :category-id="plan.categoryId" />

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm leading-tight font-medium">{{ planTitle({ plan }) }}</span>
          <div class="flex items-center gap-1.5">
            <DesktopOnlyTooltip v-if="isPlanUnconfirmed({ plan })" :content="planUnconfirmedTooltip({ plan })">
              <span
                class="text-warning-text bg-warning/10 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none font-medium"
              >
                <AlertCircleIcon class="size-3" />
                {{ $t('records.upcomingSection.unconfirmedBadge') }}
              </span>
            </DesktopOnlyTooltip>
            <span
              v-else
              class="text-muted-foreground bg-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none font-medium"
            >
              {{ $t('records.upcomingSection.expectedBadge') }}
            </span>
            <span class="text-muted-foreground text-xs">{{ planDate({ plan }) }}</span>
          </div>
        </div>

        <span
          :class="[
            'text-amount shrink-0 text-sm',
            plan.transactionType === TRANSACTION_TYPES.income ? 'text-app-income-color' : 'text-app-expense-color',
          ]"
        >
          {{ planAmount({ plan }) }}
        </span>

        <div class="flex shrink-0 items-center gap-1">
          <DesktopOnlyTooltip v-if="canConfirmPlan({ plan })" :content="$t('records.upcomingSection.confirmTooltip')">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('records.upcomingSection.confirmAction')"
              :disabled="confirmPlanMutation.isPending.value"
              @click="confirmPlanMutation.mutate({ plan })"
            >
              <CircleCheckIcon class="text-app-income-color size-3.5" />
            </Button>
          </DesktopOnlyTooltip>
          <DesktopOnlyTooltip :content="$t('common.actions.edit')">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('common.actions.edit')"
              @click="handleEditPlan({ plan })"
            >
              <PencilIcon class="size-3.5" />
            </Button>
          </DesktopOnlyTooltip>
          <DesktopOnlyTooltip :content="$t('common.actions.delete')">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :aria-label="$t('common.actions.delete')"
              @click="handleDeletePlan({ plan })"
            >
              <Trash2Icon class="size-3.5" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </div>

      <span v-if="hiddenPlansCount > 0" class="text-muted-foreground text-xs">
        {{
          isHiddenPlansCountPartial
            ? $t('records.upcomingSection.morePlansAtLeast', { count: hiddenPlansCount })
            : $t('records.upcomingSection.morePlans', { count: hiddenPlansCount })
        }}
      </span>
    </div>

    <!-- Mark-paid dialog instance owned here; avoids duplicating it per list row. -->
    <SubscriptionMarkPaidDialog ref="markPaidDialogRef" />

    <TransactionDetailsModal v-model:open="isEditDialogOpen" :mobile="isMobile">
      <ManageTransactionDialogContent :transaction="editedPlan" @close-modal="isEditDialogOpen = false" />
    </TransactionDetailsModal>

    <ResponsiveAlertDialog
      v-model:open="isDeleteDialogOpen"
      :confirm-label="$t('common.actions.delete')"
      confirm-variant="destructive"
      :confirm-disabled="deletePlanMutation.isPending.value"
      @confirm="confirmDeletePlan"
    >
      <template #title>{{ $t('records.upcomingSection.deletePlanTitle') }}</template>
      <template #description>{{ $t('records.upcomingSection.deletePlanDescription') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
