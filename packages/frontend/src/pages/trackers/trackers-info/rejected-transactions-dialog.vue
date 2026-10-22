<script setup lang="ts">
import { restoreTrackerSuggestions } from '@/api/trackers';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { useDateLocale } from '@/composable/use-date-locale';
import { useCategoriesStore } from '@/stores';
import { type RecordId, TRANSACTION_TYPES, type TrackerPendingSuggestion } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { reportTrackerError, useInvalidateTracker } from '../components/use-tracker-actions';

const props = defineProps<{
  trackerId: string;
  rejected: TrackerPendingSuggestion[];
}>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const invalidateTracker = useInvalidateTracker();
const { addSuccessNotification } = useNotificationCenter();
const { format } = useDateLocale();
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { nameById: payeeNameById } = usePayeeLookup();

const rows = computed(() =>
  props.rejected.map(({ id, score, transaction }) => {
    const category = categoriesMap.value[transaction.categoryId];
    const categoryName = category?.name ?? t('common.ui.other');
    const isExpense = transaction.transactionType === TRANSACTION_TYPES.expense;
    return {
      id,
      isAiVerdict: score > 0,
      category,
      label: (transaction.payeeId && payeeNameById.value[transaction.payeeId]) || transaction.note || categoryName,
      caption: `${format(new Date(transaction.time), 'd MMM')} · ${categoryName}`,
      amount: formatUIAmount(isExpense ? -transaction.amount : transaction.amount, {
        currency: transaction.currencyCode,
      }),
      amountClass: isExpense ? 'text-app-expense-color' : 'text-app-income-color',
    };
  }),
);

watch(
  () => props.rejected.length,
  (count) => {
    if (!count) open.value = false;
  },
);

const allowAgain = useMutation({
  mutationFn: ({ suggestionId }: { suggestionId: RecordId }) =>
    restoreTrackerSuggestions({ trackerId: props.trackerId, suggestionIds: [suggestionId] }),
  onSuccess: () => {
    addSuccessNotification(t('budgets.rules.rejected.allowed'));
    return invalidateTracker({ trackerId: props.trackerId });
  },
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.rules.rejected.allowError',
      context: { source: 'trackerAllowRejected', trackerId: props.trackerId },
    }),
});
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-lg">
    <template #title>{{ $t('budgets.rules.rejected.title') }}</template>
    <template #description>{{ $t('budgets.rules.rejected.description') }}</template>

    <ul class="divide-border divide-y">
      <li v-for="row in rows" :key="row.id" class="flex items-center gap-3 py-2.5">
        <CategoryCircle v-if="row.category" :category="row.category" />
        <span v-else class="bg-muted size-5 shrink-0 rounded-full" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ row.label }}</div>
          <div class="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
            <span class="truncate">{{ row.caption }}</span>
            <span v-if="row.isAiVerdict" class="bg-muted shrink-0 rounded-full px-1.5 py-px font-medium">
              {{ $t('budgets.rules.rejected.aiBadge') }}
            </span>
          </div>
        </div>
        <span :class="cn('text-amount shrink-0 text-sm whitespace-nowrap', row.amountClass)">{{ row.amount }}</span>
        <Button
          size="sm"
          variant="outline"
          :disabled="allowAgain.isPending.value"
          :loading="allowAgain.isPending.value && allowAgain.variables.value?.suggestionId === row.id"
          @click="allowAgain.mutate({ suggestionId: row.id })"
        >
          {{ $t('budgets.rules.rejected.allowAgain') }}
        </Button>
      </li>
    </ul>
  </ResponsiveDialog>
</template>
