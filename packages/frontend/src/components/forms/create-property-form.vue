<script setup lang="ts">
import { createProperty } from '@/api/properties';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { PROPERTY_TYPE_TRANSLATION_KEYS } from '@/common/const/property-types-verbose';
import FieldLabel from '@/components/fields/components/field-label.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useCurrencyName } from '@/composable';
import { useFormValidation } from '@/composable/form-validator';
import { captureException } from '@/lib/sentry';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import {
  ACCOUNT_CATEGORIES,
  DEFAULT_ANNUAL_APPRECIATION_RATE_PCT,
  MAX_ANNUAL_APPRECIATION_RATE_PCT,
  MIN_ANNUAL_APPRECIATION_RATE_PCT,
  PROPERTY_TYPE,
} from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { between, helpers, maxValue, required } from '@vuelidate/validators';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const MIN_YEAR_BUILT = 1000;
const MAX_YEAR_BUILT = new Date().getFullYear() + 5;
/** Sentinel for the "no mortgage" option — Select values must be non-empty strings. */
const NO_MORTGAGE = 'none';

const positiveNumber = helpers.withMessage('Must be greater than 0', (v: unknown) => v != null && Number(v) > 0);

const emit = defineEmits<{ created: [] }>();

const { t } = useI18n();
const queryClient = useQueryClient();
const { addNotification } = useNotificationCenter();
const { formatCurrencyLabel } = useCurrencyName();
const { baseCurrency, systemCurrenciesVerbose } = storeToRefs(useCurrenciesStore());
const { accounts } = storeToRefs(useAccountsStore());

const defaultCurrency = computed(
  () =>
    systemCurrenciesVerbose.value.linked.find((i) => i.code === baseCurrency.value?.currencyCode)?.code ??
    systemCurrenciesVerbose.value.linked[0]?.code ??
    '',
);

interface FormState {
  name: string;
  currencyCode: string;
  address: string;
  city: string;
  country: string;
  propertyType: PROPERTY_TYPE;
  yearBuilt: number | null;
  notes: string;
  purchasePrice: number;
  purchaseDate: Date;
  annualAppreciationRatePct: number;
  loanAccountId: string;
}

const form = reactive<FormState>({
  name: '',
  currencyCode: String(defaultCurrency.value),
  address: '',
  city: '',
  country: '',
  propertyType: PROPERTY_TYPE.house,
  yearBuilt: null,
  notes: '',
  purchasePrice: 0,
  purchaseDate: new Date(),
  annualAppreciationRatePct: DEFAULT_ANNUAL_APPRECIATION_RATE_PCT,
  loanAccountId: NO_MORTGAGE,
});

const propertyTypeOptions = computed(() =>
  Object.values(PROPERTY_TYPE).map((value) => ({
    label: t(PROPERTY_TYPE_TRANSLATION_KEYS[value]),
    value,
  })),
);

const selectedPropertyType = computed(
  () => propertyTypeOptions.value.find((o) => o.value === form.propertyType) ?? null,
);

// Only loan accounts can back a property; the backend rejects anything else.
const loanAccounts = computed(() =>
  (accounts.value ?? []).filter((account) => account.accountCategory === ACCOUNT_CATEGORIES.loan),
);

const validationRules = {
  name: { required },
  address: { required },
  purchasePrice: { positive: positiveNumber, maxValue: maxValue(Number.MAX_SAFE_INTEGER) },
  annualAppreciationRatePct: {
    required,
    between: between(MIN_ANNUAL_APPRECIATION_RATE_PCT, MAX_ANNUAL_APPRECIATION_RATE_PCT),
  },
  yearBuilt: { between: between(MIN_YEAR_BUILT, MAX_YEAR_BUILT) },
};

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: validationRules });

const createPropertyMutation = useMutation({ mutationFn: createProperty });

const submit = async () => {
  if (createPropertyMutation.isPending.value) return;
  if (!isFormValid()) return;

  try {
    await createPropertyMutation.mutateAsync({
      name: form.name,
      currencyCode: form.currencyCode,
      address: form.address,
      city: form.city || null,
      country: form.country || null,
      propertyType: form.propertyType,
      yearBuilt: form.yearBuilt,
      notes: form.notes || null,
      purchasePrice: form.purchasePrice,
      purchaseDate: format(form.purchaseDate, 'yyyy-MM-dd'),
      annualAppreciationRatePct: form.annualAppreciationRatePct,
      loanAccountId: form.loanAccountId === NO_MORTGAGE ? null : form.loanAccountId,
    });

    addNotification({
      text: t('forms.createProperty.notifications.success'),
      type: NotificationType.success,
    });

    // Property cache keys are prefixed with `transactionChange`, so a single
    // predicate invalidation also covers propertiesList.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange);
      },
    });

    emit('created');
  } catch (error) {
    addNotification({
      text: t('forms.createProperty.notifications.error'),
      type: NotificationType.error,
    });
    captureException({ error, context: { source: 'createPropertyForm' } });
  }
};
</script>

<template>
  <form class="grid gap-6" @submit.prevent="submit">
    <input-field
      v-model="form.name"
      :label="$t('forms.createProperty.nameLabel')"
      :placeholder="$t('forms.createProperty.namePlaceholder')"
      :error-message="getFieldErrorMessage('form.name')"
      @blur="touchField('form.name')"
    />

    <div>
      <FieldLabel :label="$t('forms.createProperty.currencyLabel')">
        <Select.Select v-model="form.currencyCode">
          <Select.SelectTrigger>
            <Select.SelectValue />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <template v-for="item of systemCurrenciesVerbose.linked" :key="item.code">
              <Select.SelectItem :value="String(item.code)">
                {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
              </Select.SelectItem>
            </template>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <input-field
      v-model="form.address"
      :label="$t('forms.createProperty.addressLabel')"
      :placeholder="$t('forms.createProperty.addressPlaceholder')"
      :error-message="getFieldErrorMessage('form.address')"
      @blur="touchField('form.address')"
    />

    <div class="grid grid-cols-2 gap-4">
      <input-field
        v-model="form.city"
        :label="$t('forms.createProperty.cityLabel')"
        :placeholder="$t('forms.createProperty.cityPlaceholder')"
      />
      <input-field
        v-model="form.country"
        :label="$t('forms.createProperty.countryLabel')"
        :placeholder="$t('forms.createProperty.countryPlaceholder')"
      />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <SelectField
        :model-value="selectedPropertyType"
        :values="propertyTypeOptions"
        label-key="label"
        value-key="value"
        :label="$t('forms.createProperty.propertyTypeLabel')"
        @update:model-value="(v) => v && (form.propertyType = v.value)"
      />
      <input-field
        v-model="form.yearBuilt"
        type="number"
        :label="$t('forms.createProperty.yearBuiltLabel')"
        :error-message="getFieldErrorMessage('form.yearBuilt')"
        @blur="touchField('form.yearBuilt')"
      />
    </div>

    <input-field
      v-model="form.purchasePrice"
      type="number"
      :label="$t('forms.createProperty.purchasePriceLabel')"
      :error-message="getFieldErrorMessage('form.purchasePrice')"
      @blur="touchField('form.purchasePrice')"
    />

    <DateField v-model="form.purchaseDate" :label="$t('forms.createProperty.purchaseDateLabel')" />

    <div class="grid gap-1">
      <input-field
        v-model="form.annualAppreciationRatePct"
        type="number"
        :label="$t('forms.createProperty.annualAppreciationRatePctLabel')"
        :error-message="getFieldErrorMessage('form.annualAppreciationRatePct')"
        @blur="touchField('form.annualAppreciationRatePct')"
      />
      <p class="text-muted-foreground text-xs">
        {{ $t('forms.createProperty.annualAppreciationRatePctDescription') }}
      </p>
    </div>

    <div v-if="loanAccounts.length">
      <FieldLabel :label="$t('forms.createProperty.mortgageLabel')">
        <Select.Select v-model="form.loanAccountId">
          <Select.SelectTrigger>
            <Select.SelectValue />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <Select.SelectItem :value="NO_MORTGAGE">
              {{ $t('forms.createProperty.mortgageNone') }}
            </Select.SelectItem>
            <Select.SelectItem v-for="account of loanAccounts" :key="account.id" :value="String(account.id)">
              {{ account.name }}
            </Select.SelectItem>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <TextareaField
      v-model="form.notes"
      :label="$t('forms.createProperty.notesLabel')"
      :placeholder="$t('forms.createProperty.notesPlaceholder')"
    />

    <div class="flex">
      <ui-button type="submit" class="ml-auto min-w-30" :disabled="createPropertyMutation.isPending.value">
        {{
          createPropertyMutation.isPending.value
            ? $t('forms.createProperty.submitButtonLoading')
            : $t('forms.createProperty.submitButton')
        }}
      </ui-button>
    </div>
  </form>
</template>
