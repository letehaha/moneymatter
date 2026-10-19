<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import type { BudgetModel } from '@bt/shared/types';
import { differenceInCalendarDays, differenceInMonths } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { parseTrackerDate } from '../tracker-time-status';
import { useTrackerActions } from './use-tracker-actions';

const props = defineProps<{ budget: BudgetModel | null }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { archive, dismissArchivePrompt } = useTrackerActions();

const endedAgo = computed(() => {
  const end = parseTrackerDate(props.budget?.endDate);
  if (!end) return '';
  const now = new Date();
  const months = differenceInMonths(now, end);
  if (months >= 1) return t('budgets.list.archivePrompt.endedMonthsAgo', { count: months }, months);
  const days = differenceInCalendarDays(now, end);
  return t('budgets.list.archivePrompt.endedDaysAgo', { count: days }, days);
});

const close = () => (open.value = false);
const isPending = computed(() => archive.isPending.value || dismissArchivePrompt.isPending.value);
</script>

<template>
  <ResponsiveDialog v-model:open="open">
    <template #title>{{ $t('budgets.list.archivePrompt.title', { name: budget?.name ?? '' }) }}</template>

    <p class="text-muted-foreground text-sm leading-relaxed">
      {{ $t('budgets.list.archivePrompt.description', { ago: endedAgo }) }}
    </p>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          class="text-muted-foreground mr-auto"
          :disabled="isPending"
          @click="budget && dismissArchivePrompt.mutate({ budgetId: budget.id }, { onSuccess: close })"
        >
          {{ $t('budgets.list.archivePrompt.dontAsk') }}
        </Button>
        <Button variant="outline" :disabled="isPending" @click="close">
          {{ $t('budgets.list.archivePrompt.notNow') }}
        </Button>
        <Button :disabled="isPending" @click="budget && archive.mutate({ budgetId: budget.id }, { onSuccess: close })">
          {{ $t('budgets.list.archive') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
