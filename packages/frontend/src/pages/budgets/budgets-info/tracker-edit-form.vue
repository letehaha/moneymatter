<script setup lang="ts">
import { editBudget } from '@/api/budgets';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError, extractApiErrorMessage } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { BUDGET_TYPES, type BudgetModel } from '@bt/shared/types';
import { XIcon } from '@lucide/vue';
import { useMutation } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useInvalidateTracker } from '../components/use-tracker-actions';
import { parseTrackerDate } from '../tracker-time-status';
import { buildBudgetEditPayload } from './build-budget-edit-payload';

const props = defineProps<{ budget: BudgetModel }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const { t } = useI18n();
const invalidateTracker = useInvalidateTracker();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isCategoryTracker = props.budget.type === BUDGET_TYPES.category;

const form = ref({
  name: props.budget.name,
  limitAmount: (props.budget.limitAmount ?? null) as string | number | null,
  startDate: parseTrackerDate(props.budget.startDate),
  endDate: parseTrackerDate(props.budget.endDate),
  categoryIds: props.budget.categories?.map((c) => c.id) ?? [],
});

const { mutate, isPending } = useMutation({
  mutationFn: editBudget,
  onSuccess: () => {
    addSuccessNotification(t('budgets.list.updateSuccess'));
    emit('saved');
    return invalidateTracker({ budgetId: props.budget.id });
  },
  onError: (error) => {
    addErrorNotification(extractApiErrorMessage(error) || t('budgets.list.updateError'));
    if (!(error instanceof ApiErrorResponseError)) {
      captureException({ error, context: { source: 'trackerEdit', budgetId: props.budget.id } });
    }
  },
});

const dateFields = computed(() => [
  {
    key: 'startDate' as const,
    labelKey: 'budgets.settings.startDateLabel',
    calendarOptions: { maxDate: form.value.endDate ?? undefined },
  },
  {
    key: 'endDate' as const,
    labelKey: 'budgets.settings.endDateLabel',
    calendarOptions: { minDate: form.value.startDate ?? undefined },
  },
]);

const handleSubmit = () => {
  mutate({
    budgetId: props.budget.id,
    payload: buildBudgetEditPayload({
      name: form.value.name,
      limitAmount: form.value.limitAmount,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
      categoryIds: isCategoryTracker ? form.value.categoryIds : undefined,
    }),
  });
};
</script>

<template>
  <form class="grid gap-4" @submit.prevent="handleSubmit">
    <InputField
      v-model="form.name"
      :label="$t('budgets.settings.nameLabel')"
      :placeholder="$t('budgets.settings.namePlaceholder')"
      :disabled="isPending"
    />

    <div v-if="isCategoryTracker" class="grid gap-1.5">
      <CategoryMultiSelectField
        v-model="form.categoryIds"
        :label="$t('budgets.creation.categoriesLabel')"
        :placeholder="$t('budgets.lines.dialog.categoriesPlaceholder')"
        :disabled="isPending"
      />
      <p class="text-muted-foreground text-xs">{{ $t('budgets.details.edit.categoriesHint') }}</p>
    </div>

    <div class="grid gap-1.5">
      <InputField
        v-model="form.limitAmount"
        :label="$t('budgets.settings.limitLabel')"
        :placeholder="$t('budgets.settings.limitPlaceholder')"
        type="number"
        only-positive
        :disabled="isPending"
      />
      <p class="text-muted-foreground text-xs">{{ $t('budgets.details.edit.limitHint') }}</p>
    </div>

    <div class="grid gap-1.5">
      <div class="grid grid-cols-2 gap-3">
        <div v-for="field in dateFields" :key="field.key" class="flex items-end gap-1">
          <DateField
            :model-value="form[field.key] ?? undefined"
            :calendar-options="field.calendarOptions"
            :label="$t(field.labelKey)"
            :disabled="isPending"
            @update:model-value="(v: Date | undefined) => (form[field.key] = v ?? null)"
          />
          <DesktopOnlyTooltip v-if="form[field.key]" :content="$t('budgets.details.edit.clearDate')">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="mb-0.5 shrink-0"
              :disabled="isPending"
              :aria-label="$t('budgets.details.edit.clearDate')"
              @click="form[field.key] = null"
            >
              <XIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </div>
      <p v-if="!isCategoryTracker" class="text-muted-foreground text-xs">
        {{ $t('budgets.details.edit.datesHint') }}
      </p>
    </div>

    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">
        {{ $t('common.actions.cancel') }}
      </Button>
      <Button type="submit" :disabled="isPending || !form.name">
        {{ isPending ? $t('common.actions.saving') : $t('common.actions.saveChanges') }}
      </Button>
    </div>
  </form>
</template>
