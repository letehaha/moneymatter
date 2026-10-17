<script setup lang="ts">
import { overridePropertyValue } from '@/api/properties';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { useFormValidation } from '@/composable/form-validator';
import { captureException } from '@/lib/sentry';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { minValue, required } from '@vuelidate/validators';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  propertyId: string;
  accountId: string;
  currentValue: number;
  currencyCode: string;
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const queryClient = useQueryClient();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const form = reactive({
  targetValue: props.currentValue,
  note: '',
  time: new Date(),
});

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation(
  { form },
  { form: { targetValue: { required, minValue: minValue(0) } } },
);

const difference = computed(() => form.targetValue - props.currentValue);

const revalueMutation = useMutation({ mutationFn: overridePropertyValue });

const submit = async () => {
  if (revalueMutation.isPending.value) return;
  if (!isFormValid()) return;

  try {
    await revalueMutation.mutateAsync({
      id: props.propertyId,
      accountId: props.accountId,
      targetValue: form.targetValue,
      note: form.note || undefined,
      time: form.time,
    });

    addNotification({
      text: t('pages.propertyDetails.revaluationDialog.success'),
      type: NotificationType.success,
    });

    queryClient.invalidateQueries({
      predicate: (q) => (q.queryKey as string[]).includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange),
    });

    open.value = false;
  } catch (error) {
    addNotification({
      text: t('pages.propertyDetails.revaluationDialog.error'),
      type: NotificationType.error,
    });
    captureException({ error, context: { source: 'propertyRevaluationDialog', propertyId: props.propertyId } });
  }
};
</script>

<template>
  <ResponsiveDialog v-model:open="open">
    <template #title>{{ $t('pages.propertyDetails.revaluationDialog.title') }}</template>

    <form class="grid gap-6" @submit.prevent="submit">
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.propertyDetails.revaluationDialog.description') }}
      </p>

      <input-field
        v-model="form.targetValue"
        type="number"
        :label="$t('pages.propertyDetails.revaluationDialog.targetValueLabel')"
        :error-message="getFieldErrorMessage('form.targetValue')"
        @blur="touchField('form.targetValue')"
      />

      <DateField v-model="form.time" :label="$t('pages.propertyDetails.revaluationDialog.dateLabel')" />

      <input-field
        v-model="form.note"
        :label="$t('pages.propertyDetails.revaluationDialog.noteLabel')"
        :placeholder="$t('pages.propertyDetails.revaluationDialog.notePlaceholder')"
      />

      <div v-if="difference !== 0" class="bg-muted/30 rounded-lg px-3 py-2 text-sm">
        <span class="text-muted-foreground">{{ $t('pages.propertyDetails.revaluationDialog.changeLabel') }}</span>
        <span
          class="ml-2 font-medium tabular-nums"
          :class="difference > 0 ? 'text-app-income-color' : 'text-app-expense-color'"
        >
          {{ difference > 0 ? '+' : '−' }}
          {{ formatAmountByCurrencyCode(Math.abs(difference), currencyCode) }}
        </span>
      </div>

      <div class="flex">
        <ui-button
          type="submit"
          class="ml-auto min-w-30"
          :disabled="revalueMutation.isPending.value || difference === 0"
        >
          {{
            revalueMutation.isPending.value
              ? $t('pages.propertyDetails.revaluationDialog.submitLoading')
              : $t('pages.propertyDetails.revaluationDialog.submit')
          }}
        </ui-button>
      </div>
    </form>
  </ResponsiveDialog>
</template>
