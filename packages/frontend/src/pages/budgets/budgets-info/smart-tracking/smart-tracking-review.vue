<script setup lang="ts">
import { acceptTrackerSuggestions, rejectTrackerSuggestions, restoreTrackerSuggestions } from '@/api/budgets';
import AccountLogo from '@/components/common/account-logo.vue';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCategoriesStore } from '@/stores';
import {
  type BudgetModel,
  type ResolveTrackerSuggestionsBody,
  TRANSACTION_TYPES,
  type TrackerPendingSuggestion,
} from '@bt/shared/types';
import { CheckIcon, XIcon } from '@lucide/vue';
import { useMutation } from '@tanstack/vue-query';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { reportTrackerError, useInvalidateTracker } from '../../components/use-tracker-actions';
import { getSuggestionConfidence } from './smart-tracking-state';

const props = defineProps<{
  budget: BudgetModel;
  pending: TrackerPendingSuggestion[];
}>();

const { t } = useI18n();
const invalidateTracker = useInvalidateTracker();
const { addNotification, addSuccessNotification } = useNotificationCenter();
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { accountsRecord } = storeToRefs(useAccountsStore());
const { nameById: payeeNameById } = usePayeeLookup();

const budgetId = computed(() => props.budget.id);

const rows = computed(() =>
  props.pending.map(({ id, score, reason, transaction }) => {
    const category = categoriesMap.value[transaction.categoryId];
    const categoryName = category?.name ?? t('common.ui.other');
    const payee = (transaction.payeeId && payeeNameById.value[transaction.payeeId]) || transaction.note || '';
    const isExpense = transaction.transactionType === TRANSACTION_TYPES.expense;

    return {
      id,
      reason,
      confidence: getSuggestionConfidence({ score }),
      category,
      categoryName,
      payee,
      label: payee || categoryName,
      amount: formatUIAmount(isExpense ? -transaction.amount : transaction.amount, {
        currency: transaction.currencyCode,
      }),
      amountClass: isExpense ? 'text-app-expense-color' : 'text-app-income-color',
      date: format(new Date(transaction.time), 'd MMM'),
      account: accountsRecord.value[transaction.accountId],
    };
  }),
);

const allIds = computed(() => props.pending.map(({ id }) => id));

const errorContext = (source: string) => ({ source, budgetId: budgetId.value });

const restore = useMutation({
  mutationFn: ({ suggestionIds }: ResolveTrackerSuggestionsBody) =>
    restoreTrackerSuggestions({ budgetId: budgetId.value, suggestionIds }),
  onSuccess: () => invalidateTracker({ budgetId: budgetId.value }),
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.smartTracking.review.restoreError',
      context: errorContext('trackerRestoreSuggestions'),
    }),
});

const accept = useMutation({
  mutationFn: ({ suggestionIds }: ResolveTrackerSuggestionsBody) =>
    acceptTrackerSuggestions({ budgetId: budgetId.value, suggestionIds }),
  onSuccess: (_data, { suggestionIds }) => {
    const count = suggestionIds.length;
    addSuccessNotification(t('budgets.smartTracking.review.added', { count, name: props.budget.name }, count));
    return invalidateTracker({ budgetId: budgetId.value });
  },
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.smartTracking.review.acceptError',
      context: errorContext('trackerAcceptSuggestions'),
    }),
});

const reject = useMutation({
  mutationFn: ({ suggestionIds }: ResolveTrackerSuggestionsBody) =>
    rejectTrackerSuggestions({ budgetId: budgetId.value, suggestionIds }),
  onSuccess: (_data, { suggestionIds }) => {
    addNotification({
      text: t('budgets.smartTracking.review.skipped', { count: suggestionIds.length }, suggestionIds.length),
      type: NotificationType.success,
      action: {
        label: t('budgets.smartTracking.undo'),
        onClick: () => restore.mutate({ suggestionIds }),
      },
    });
    return invalidateTracker({ budgetId: budgetId.value });
  },
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.smartTracking.review.rejectError',
      context: errorContext('trackerRejectSuggestions'),
    }),
});

const isBusy = computed(() => accept.isPending.value || reject.isPending.value || restore.isPending.value);

const PILL_CLASSES = {
  likely: 'bg-primary/10 text-primary-text',
  possible: 'bg-muted text-muted-foreground',
} as const;
</script>

<template>
  <div class="border-t px-3 pt-2 pb-3 @md/tracker-tx:px-4">
    <div class="flex items-center gap-2 py-1">
      <span class="text-muted-foreground flex-1 text-xs font-semibold tracking-wider uppercase">
        {{
          $t('budgets.smartTracking.review.sectionTitle', {
            count: rows.length,
          })
        }}
      </span>
      <div class="flex gap-1 @xl/tracker-tx:hidden">
        <Button size="sm" variant="ghost" :disabled="isBusy" @click="reject.mutate({ suggestionIds: allIds })">
          {{ $t('budgets.smartTracking.review.skipAll') }}
        </Button>
        <Button size="sm" variant="ghost-primary" :disabled="isBusy" @click="accept.mutate({ suggestionIds: allIds })">
          {{ $t('budgets.smartTracking.review.addAllShort') }}
        </Button>
      </div>
    </div>

    <ul class="divide-border divide-y">
      <li
        v-for="row in rows"
        :key="row.id"
        class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2 @xl/tracker-tx:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]"
      >
        <CategoryCircle v-if="row.category" :category="row.category" />
        <span v-else class="bg-muted size-5 rounded-full" />

        <div class="min-w-0">
          <div class="flex min-w-0 items-baseline gap-2 text-sm">
            <span class="hidden truncate @xl/tracker-tx:inline">
              {{ row.categoryName }}<span v-if="row.payee" class="text-muted-foreground"> · {{ row.payee }}</span>
            </span>
            <span class="min-w-0 flex-1 truncate font-medium @xl/tracker-tx:hidden">{{ row.label }}</span>
            <span :class="cn('text-amount shrink-0 whitespace-nowrap @xl/tracker-tx:hidden', row.amountClass)">
              {{ row.amount }}
            </span>
          </div>
          <div class="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
            <span :class="cn('shrink-0 rounded-full px-1.5 py-px font-medium', PILL_CLASSES[row.confidence])">
              {{ $t(`budgets.smartTracking.review.confidence.${row.confidence}`) }}
            </span>
            <ResponsiveTooltip :content="row.reason" content-class-name="max-w-72" :delay-duration="100">
              <span class="text-muted-foreground min-w-0 cursor-help truncate" tabindex="0">{{ row.reason }}</span>
            </ResponsiveTooltip>
          </div>
        </div>

        <span
          :class="cn('text-amount hidden text-right text-sm whitespace-nowrap @xl/tracker-tx:block', row.amountClass)"
        >
          {{ row.amount }}
        </span>

        <div class="text-muted-foreground hidden text-right text-xs @xl/tracker-tx:block">
          <div>{{ row.date }}</div>
          <div v-if="row.account" class="flex items-center justify-end gap-1">
            <AccountLogo :account="row.account" class="size-3.5 rounded-sm" />
            <span class="max-w-32 truncate">{{ row.account.name }}</span>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <div class="hidden gap-1 @xl/tracker-tx:flex">
            <Button
              size="sm"
              variant="soft-success"
              :disabled="isBusy"
              :aria-label="
                $t('budgets.smartTracking.review.addAria', {
                  name: row.label,
                  tracker: budget.name,
                })
              "
              @click="accept.mutate({ suggestionIds: [row.id] })"
            >
              {{ $t('budgets.smartTracking.review.add') }}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :disabled="isBusy"
              :aria-label="$t('budgets.smartTracking.review.skipAria', { name: row.label })"
              @click="reject.mutate({ suggestionIds: [row.id] })"
            >
              {{ $t('budgets.smartTracking.review.skip') }}
            </Button>
          </div>
          <div class="flex gap-1 @xl/tracker-tx:hidden">
            <DesktopOnlyTooltip :content="$t('budgets.smartTracking.review.add')">
              <Button
                size="icon-sm"
                variant="outline"
                :disabled="isBusy"
                :aria-label="
                  $t('budgets.smartTracking.review.addAria', {
                    name: row.label,
                    tracker: budget.name,
                  })
                "
                @click="accept.mutate({ suggestionIds: [row.id] })"
              >
                <CheckIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
            <DesktopOnlyTooltip :content="$t('budgets.smartTracking.review.skip')">
              <Button
                size="icon-sm"
                variant="ghost"
                :disabled="isBusy"
                :aria-label="
                  $t('budgets.smartTracking.review.skipAria', {
                    name: row.label,
                  })
                "
                @click="reject.mutate({ suggestionIds: [row.id] })"
              >
                <XIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
        </div>
      </li>
    </ul>

    <div class="hidden gap-2 pt-2 @xl/tracker-tx:flex">
      <Button size="sm" :disabled="isBusy" @click="accept.mutate({ suggestionIds: allIds })">
        {{ $t('budgets.smartTracking.review.addAll', { count: rows.length }) }}
      </Button>
      <Button size="sm" variant="secondary" :disabled="isBusy" @click="reject.mutate({ suggestionIds: allIds })">
        {{ $t('budgets.smartTracking.review.skipAll') }}
      </Button>
    </div>
  </div>
</template>
