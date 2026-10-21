<script setup lang="ts">
import { createVehicle } from '@/api/vehicles';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import {
  DEPRECIATION_PRESET_TRANSLATION_KEYS,
  VEHICLE_CLASS_TRANSLATION_KEYS,
} from '@/common/const/vehicle-classes-verbose';
import FieldLabel from '@/components/fields/components/field-label.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useCurrencyName } from '@/composable';
import { useFormValidation } from '@/composable/form-validator';
import { captureException } from '@/lib/sentry';
import { useCurrenciesStore } from '@/stores';
import { DEPRECIATION_PRESET, VEHICLE_CLASS } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { between, helpers, maxValue, minValue, required, requiredIf } from '@vuelidate/validators';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const DEFAULT_SALVAGE_FLOOR_PCT = 10;
const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 1;
const MAX_MILEAGE = 10_000_000;

const positiveNumber = helpers.withMessage('Must be greater than 0', (v: unknown) => v != null && Number(v) > 0);

const emit = defineEmits<{ created: [] }>();

const { t } = useI18n();
const queryClient = useQueryClient();
const currenciesStore = useCurrenciesStore();
const { addNotification } = useNotificationCenter();
const { formatCurrencyLabel } = useCurrencyName();
const { baseCurrency, isoCurrenciesVerbose } = storeToRefs(currenciesStore);

const defaultCurrency = computed(
  () =>
    isoCurrenciesVerbose.value.linked.find((i) => i.code === baseCurrency.value?.currencyCode)?.code ??
    isoCurrenciesVerbose.value.linked[0]?.code ??
    '',
);

interface FormState {
  name: string;
  currencyCode: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  vehicleClass: VEHICLE_CLASS;
  purchasePrice: number;
  purchaseDate: Date;
  depreciationPreset: DEPRECIATION_PRESET;
  customAnnualRatePct: number | null;
  salvageFloorPct: number;
  currentMileage: number | null;
}

const form = reactive<FormState>({
  name: '',
  currencyCode: String(defaultCurrency.value),
  make: '',
  model: '',
  trim: '',
  year: new Date().getFullYear(),
  vehicleClass: VEHICLE_CLASS.sedan,
  purchasePrice: 0,
  purchaseDate: new Date(),
  depreciationPreset: DEPRECIATION_PRESET.classDefault,
  customAnnualRatePct: null,
  salvageFloorPct: DEFAULT_SALVAGE_FLOOR_PCT,
  currentMileage: null,
});

const vehicleClassOptions = computed(() =>
  Object.values(VEHICLE_CLASS).map((value) => ({
    label: t(VEHICLE_CLASS_TRANSLATION_KEYS[value]),
    value,
  })),
);

const depreciationPresetOptions = computed(() =>
  Object.values(DEPRECIATION_PRESET).map((value) => ({
    label: t(DEPRECIATION_PRESET_TRANSLATION_KEYS[value]),
    value,
  })),
);

const selectedVehicleClass = computed(
  () => vehicleClassOptions.value.find((o) => o.value === form.vehicleClass) ?? null,
);

const selectedDepreciationPreset = computed(
  () => depreciationPresetOptions.value.find((o) => o.value === form.depreciationPreset) ?? null,
);

const showCustomRate = computed(() => form.depreciationPreset === DEPRECIATION_PRESET.custom);

const validationRules = {
  name: { required },
  make: { required },
  model: { required },
  year: { required, between: between(MIN_YEAR, MAX_YEAR) },
  purchasePrice: { positive: positiveNumber, maxValue: maxValue(Number.MAX_SAFE_INTEGER) },
  salvageFloorPct: { required, between: between(0, 100) },
  customAnnualRatePct: {
    requiredIfCustom: requiredIf(() => form.depreciationPreset === DEPRECIATION_PRESET.custom),
    between: between(0, 100),
  },
  currentMileage: { minValue: minValue(0), maxValue: maxValue(MAX_MILEAGE) },
};

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: validationRules });

const createVehicleMutation = useMutation({ mutationFn: createVehicle });

const submit = async () => {
  if (createVehicleMutation.isPending.value) return;

  if (!isFormValid()) return;

  try {
    await createVehicleMutation.mutateAsync({
      name: form.name,
      currencyCode: form.currencyCode,
      make: form.make,
      model: form.model,
      trim: form.trim || null,
      year: form.year,
      vehicleClass: form.vehicleClass,
      purchasePrice: form.purchasePrice,
      purchaseDate: format(form.purchaseDate, 'yyyy-MM-dd'),
      depreciationPreset: form.depreciationPreset,
      customAnnualRatePct: form.depreciationPreset === DEPRECIATION_PRESET.custom ? form.customAnnualRatePct : null,
      salvageFloorPct: form.salvageFloorPct,
      currentMileage: form.currentMileage,
    });

    addNotification({
      text: t('forms.createVehicle.notifications.success'),
      type: NotificationType.success,
    });

    // Vehicle cache keys are prefixed with `transactionChange`, so a single
    // predicate invalidation also covers vehiclesList.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange);
      },
    });

    emit('created');
  } catch (error) {
    addNotification({
      text: t('forms.createVehicle.notifications.error'),
      type: NotificationType.error,
    });
    captureException({ error, context: { source: 'createVehicleForm' } });
  }
};
</script>

<template>
  <form class="grid gap-6" @submit.prevent="submit">
    <input-field
      v-model="form.name"
      :label="$t('forms.createVehicle.nameLabel')"
      :placeholder="$t('forms.createVehicle.namePlaceholder')"
      :error-message="getFieldErrorMessage('form.name')"
      @blur="touchField('form.name')"
    />

    <div>
      <FieldLabel :label="$t('forms.createVehicle.currencyLabel')">
        <Select.Select v-model="form.currencyCode">
          <Select.SelectTrigger>
            <Select.SelectValue />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <template v-for="item of isoCurrenciesVerbose.linked" :key="item.code">
              <Select.SelectItem :value="String(item.code)">
                {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
              </Select.SelectItem>
            </template>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <input-field
        v-model="form.make"
        :label="$t('forms.createVehicle.makeLabel')"
        placeholder="Toyota"
        :error-message="getFieldErrorMessage('form.make')"
        @blur="touchField('form.make')"
      />
      <input-field
        v-model="form.model"
        :label="$t('forms.createVehicle.modelLabel')"
        placeholder="Camry"
        :error-message="getFieldErrorMessage('form.model')"
        @blur="touchField('form.model')"
      />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <input-field v-model="form.trim" :label="$t('forms.createVehicle.trimLabel')" placeholder="XLE" />
      <input-field
        v-model="form.year"
        type="number"
        :label="$t('forms.createVehicle.yearLabel')"
        :error-message="getFieldErrorMessage('form.year')"
        @blur="touchField('form.year')"
      />
    </div>

    <SelectField
      :model-value="selectedVehicleClass"
      :values="vehicleClassOptions"
      label-key="label"
      value-key="value"
      :label="$t('forms.createVehicle.vehicleClassLabel')"
      @update:model-value="(v) => v && (form.vehicleClass = v.value)"
    />

    <input-field
      v-model="form.purchasePrice"
      type="number"
      :label="$t('forms.createVehicle.purchasePriceLabel')"
      :error-message="getFieldErrorMessage('form.purchasePrice')"
      @blur="touchField('form.purchasePrice')"
    />

    <DateField v-model="form.purchaseDate" :label="$t('forms.createVehicle.purchaseDateLabel')" />

    <SelectField
      :model-value="selectedDepreciationPreset"
      :values="depreciationPresetOptions"
      label-key="label"
      value-key="value"
      :label="$t('forms.createVehicle.depreciationPresetLabel')"
      @update:model-value="(v) => v && (form.depreciationPreset = v.value)"
    />

    <input-field
      v-if="showCustomRate"
      v-model="form.customAnnualRatePct"
      type="number"
      :label="$t('forms.createVehicle.customAnnualRatePctLabel')"
      :error-message="getFieldErrorMessage('form.customAnnualRatePct')"
      @blur="touchField('form.customAnnualRatePct')"
    />

    <input-field
      v-model="form.salvageFloorPct"
      type="number"
      :label="$t('forms.createVehicle.salvageFloorPctLabel')"
      :error-message="getFieldErrorMessage('form.salvageFloorPct')"
      @blur="touchField('form.salvageFloorPct')"
    />

    <input-field
      v-model="form.currentMileage"
      type="number"
      :label="$t('forms.createVehicle.currentMileageLabel')"
      :placeholder="$t('forms.createVehicle.currentMileagePlaceholder')"
      :error-message="getFieldErrorMessage('form.currentMileage')"
      @blur="touchField('form.currentMileage')"
    />

    <div class="flex">
      <ui-button type="submit" class="ml-auto min-w-30" :disabled="createVehicleMutation.isPending.value">
        {{
          createVehicleMutation.isPending.value
            ? $t('forms.createVehicle.submitButtonLoading')
            : $t('forms.createVehicle.submitButton')
        }}
      </ui-button>
    </div>
  </form>
</template>
