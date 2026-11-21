<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/** The step of a custom frequency: a count and a unit, side by side ("Repeat every [30] [days]"). */
defineProps<{
  countErrorMessage?: string;
}>();

const count = defineModel<number | null>('count', { required: true });
const unit = defineModel<SUBSCRIPTION_INTERVAL_UNITS>('unit', { required: true });

const emit = defineEmits<{ countBlur: [] }>();

const { t } = useI18n();

/** Unit labels follow the typed count ("1 day", "30 days"); an empty count reads as plural. */
const PLURAL_FALLBACK = 2;

const unitOptions = computed(() =>
  Object.values(SUBSCRIPTION_INTERVAL_UNITS).map((value) => ({
    value,
    label: t(`planned.subscriptions.frequency.units.${value}`, count.value ?? PLURAL_FALLBACK),
  })),
);

const selectedUnit = computed(() => unitOptions.value.find((option) => option.value === unit.value) ?? null);
</script>

<template>
  <div class="@container/custom-interval">
    <div class="grid grid-cols-1 items-start gap-3 @xs/custom-interval:grid-cols-2">
      <InputField
        :model-value="count ?? undefined"
        type="number"
        inputmode="numeric"
        step="1"
        :label="$t('planned.subscriptions.form.intervalCountLabel')"
        :placeholder="$t('planned.subscriptions.form.intervalCountPlaceholder')"
        :error-message="countErrorMessage"
        only-positive
        data-testid="custom-interval-count"
        @update:model-value="(v: string | number | null) => (count = v === '' || v == null ? null : Number(v))"
        @blur="emit('countBlur')"
      />
      <SelectField
        :model-value="selectedUnit"
        :values="unitOptions"
        label-key="label"
        value-key="value"
        :label="$t('planned.subscriptions.form.intervalUnitLabel')"
        :placeholder="$t('planned.subscriptions.form.intervalUnitPlaceholder')"
        @update:model-value="(v: { value: SUBSCRIPTION_INTERVAL_UNITS } | null) => v && (unit = v.value)"
      />
    </div>
  </div>
</template>
