<script setup lang="ts">
import { updateProperty, type PropertyModel } from '@/api/properties';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { PROPERTY_TYPE_TRANSLATION_KEYS } from '@/common/const/property-types-verbose';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable/form-validator';
import { captureException } from '@/lib/sentry';
import { useAccountsStore } from '@/stores';
import {
  ACCOUNT_CATEGORIES,
  MAX_ANNUAL_APPRECIATION_RATE_PCT,
  MIN_ANNUAL_APPRECIATION_RATE_PCT,
  PROPERTY_TYPE,
} from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { between, required } from '@vuelidate/validators';
import { storeToRefs } from 'pinia';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const MIN_YEAR_BUILT = 1000;
const MAX_YEAR_BUILT = new Date().getFullYear() + 5;
/** Sentinel for the "no mortgage" option — Select values must be non-empty strings. */
const NO_MORTGAGE = 'none';

const props = defineProps<{ property: PropertyModel }>();
const emit = defineEmits<{ updated: [] }>();

const { t } = useI18n();
const queryClient = useQueryClient();
const { addNotification } = useNotificationCenter();
const { accounts } = storeToRefs(useAccountsStore());

interface FormState {
  name: string;
  address: string;
  city: string;
  country: string;
  propertyType: PROPERTY_TYPE;
  yearBuilt: number | null;
  notes: string;
  annualAppreciationRatePct: number;
  loanAccountId: string;
}

const form = reactive<FormState>({
  name: props.property.account?.name ?? props.property.address,
  address: props.property.address,
  city: props.property.city ?? '',
  country: props.property.country ?? '',
  propertyType: props.property.propertyType,
  yearBuilt: props.property.yearBuilt,
  notes: props.property.notes ?? '',
  annualAppreciationRatePct: props.property.annualAppreciationRatePct,
  loanAccountId: props.property.loanAccountId ? String(props.property.loanAccountId) : NO_MORTGAGE,
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

const loanAccounts = computed(() =>
  (accounts.value ?? []).filter((account) => account.accountCategory === ACCOUNT_CATEGORIES.loan),
);

const validationRules = {
  name: { required },
  address: { required },
  annualAppreciationRatePct: {
    required,
    between: between(MIN_ANNUAL_APPRECIATION_RATE_PCT, MAX_ANNUAL_APPRECIATION_RATE_PCT),
  },
  yearBuilt: { between: between(MIN_YEAR_BUILT, MAX_YEAR_BUILT) },
};

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: validationRules });

const updatePropertyMutation = useMutation({ mutationFn: updateProperty });

const submit = async () => {
  if (updatePropertyMutation.isPending.value) return;
  if (!isFormValid()) return;

  try {
    await updatePropertyMutation.mutateAsync({
      id: props.property.id,
      payload: {
        name: form.name,
        address: form.address,
        city: form.city || null,
        country: form.country || null,
        propertyType: form.propertyType,
        yearBuilt: form.yearBuilt,
        notes: form.notes || null,
        annualAppreciationRatePct: form.annualAppreciationRatePct,
        loanAccountId: form.loanAccountId === NO_MORTGAGE ? null : form.loanAccountId,
      },
    });

    addNotification({
      text: t('forms.editProperty.notifications.success'),
      type: NotificationType.success,
    });

    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange);
      },
    });

    emit('updated');
  } catch (error) {
    addNotification({
      text: t('forms.editProperty.notifications.error'),
      type: NotificationType.error,
    });
    captureException({ error, context: { source: 'editPropertyForm', propertyId: props.property.id } });
  }
};
</script>

<template>
  <form class="grid gap-6" @submit.prevent="submit">
    <input-field
      v-model="form.name"
      :label="$t('forms.editProperty.nameLabel')"
      :error-message="getFieldErrorMessage('form.name')"
      @blur="touchField('form.name')"
    />

    <input-field
      v-model="form.address"
      :label="$t('forms.editProperty.addressLabel')"
      :error-message="getFieldErrorMessage('form.address')"
      @blur="touchField('form.address')"
    />

    <div class="grid grid-cols-2 gap-4">
      <input-field v-model="form.city" :label="$t('forms.editProperty.cityLabel')" />
      <input-field v-model="form.country" :label="$t('forms.editProperty.countryLabel')" />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <SelectField
        :model-value="selectedPropertyType"
        :values="propertyTypeOptions"
        label-key="label"
        value-key="value"
        :label="$t('forms.editProperty.propertyTypeLabel')"
        @update:model-value="(v) => v && (form.propertyType = v.value)"
      />
      <input-field
        v-model="form.yearBuilt"
        type="number"
        :label="$t('forms.editProperty.yearBuiltLabel')"
        :error-message="getFieldErrorMessage('form.yearBuilt')"
        @blur="touchField('form.yearBuilt')"
      />
    </div>

    <div class="grid gap-1">
      <input-field
        v-model="form.annualAppreciationRatePct"
        type="number"
        :label="$t('forms.editProperty.annualAppreciationRatePctLabel')"
        :error-message="getFieldErrorMessage('form.annualAppreciationRatePct')"
        @blur="touchField('form.annualAppreciationRatePct')"
      />
      <p class="text-muted-foreground text-xs">
        {{ $t('forms.editProperty.annualAppreciationRatePctDescription') }}
      </p>
    </div>

    <div v-if="loanAccounts.length">
      <FieldLabel :label="$t('forms.editProperty.mortgageLabel')">
        <Select.Select v-model="form.loanAccountId">
          <Select.SelectTrigger>
            <Select.SelectValue />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <Select.SelectItem :value="NO_MORTGAGE">
              {{ $t('forms.editProperty.mortgageNone') }}
            </Select.SelectItem>
            <Select.SelectItem v-for="account of loanAccounts" :key="account.id" :value="String(account.id)">
              {{ account.name }}
            </Select.SelectItem>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <TextareaField v-model="form.notes" :label="$t('forms.editProperty.notesLabel')" />

    <div class="flex">
      <ui-button type="submit" class="ml-auto min-w-30" :disabled="updatePropertyMutation.isPending.value">
        {{
          updatePropertyMutation.isPending.value
            ? $t('forms.editProperty.submitButtonLoading')
            : $t('forms.editProperty.submitButton')
        }}
      </ui-button>
    </div>
  </form>
</template>
