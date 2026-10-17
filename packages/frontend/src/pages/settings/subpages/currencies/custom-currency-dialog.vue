<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-md">
    <template #title>{{
      isEditing ? $t('settings.currencies.custom.editTitle') : $t('settings.currencies.custom.createTitle')
    }}</template>
    <template #description>
      {{
        isEditing
          ? $t('settings.currencies.custom.editDescription')
          : $t('settings.currencies.custom.createDescription')
      }}
    </template>

    <form :id="FORM_ID" class="grid gap-4" @submit.prevent="handleSubmit">
      <InputField
        :model-value="form.code"
        :label="$t('settings.currencies.custom.codeLabel')"
        :placeholder="$t('settings.currencies.custom.codePlaceholder')"
        :disabled="isEditing"
        :error-message="getFieldErrorMessage('form.code')"
        data-testid="custom-currency-code"
        @update:model-value="onCodeInput"
        @blur="touchField('form.code')"
      />

      <InputField
        v-model="form.name"
        :label="$t('settings.currencies.custom.nameLabel')"
        :placeholder="$t('settings.currencies.custom.namePlaceholder')"
        :error-message="getFieldErrorMessage('form.name')"
        data-testid="custom-currency-name"
        @blur="touchField('form.name')"
      />

      <div class="grid grid-cols-2 gap-3">
        <InputField
          v-model="form.symbol"
          :label="$t('settings.currencies.custom.symbolLabel')"
          :placeholder="$t('settings.currencies.custom.symbolPlaceholder')"
          :error-message="getFieldErrorMessage('form.symbol')"
          data-testid="custom-currency-symbol"
          @blur="touchField('form.symbol')"
        />

        <InputField
          v-model="form.decimals"
          type="number"
          only-positive
          :decimals="0"
          :label="$t('settings.currencies.custom.decimalsLabel')"
          :placeholder="$t('settings.currencies.custom.decimalsPlaceholder')"
          :disabled="isDecimalsLocked"
          :error-message="getFieldErrorMessage('form.decimals')"
          data-testid="custom-currency-decimals"
          @blur="touchField('form.decimals')"
        />
      </div>

      <p class="text-muted-foreground -mt-2 text-xs" data-testid="custom-currency-decimals-hint">
        {{
          isDecimalsLocked
            ? $t('settings.currencies.custom.decimalsLockedHint', { code: form.code })
            : $t('settings.currencies.custom.decimalsHint')
        }}
      </p>

      <p v-if="previewLabel" class="text-muted-foreground text-sm tabular-nums" data-testid="custom-currency-preview">
        {{ $t('settings.currencies.custom.preview', { value: previewLabel }) }}
      </p>

      <Callout v-if="formError" variant="destructive" data-testid="custom-currency-error">
        <span>{{ formError }}</span>
      </Callout>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          {{ $t('settings.currencies.custom.cancelButton') }}
        </Button>
        <Button
          type="submit"
          :form="FORM_ID"
          :disabled="isPending"
          :loading="isPending"
          data-testid="custom-currency-submit"
        >
          {{ isEditing ? $t('settings.currencies.custom.saveButton') : $t('settings.currencies.custom.createButton') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { createCustomCurrency, updateCustomCurrency } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable/form-validator';
import { extractApiErrorMessage } from '@/js/errors';
import { formatUIAmount } from '@/js/helpers';
import { helpers, required } from '@/js/helpers/validators';
import { useCurrenciesStore } from '@/stores';
import type { CurrencyMeta } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { EditableCustomCurrency } from './types';

const props = defineProps<{
  /** The currency being edited; unset creates a new one. */
  currency?: EditableCustomCurrency | null;
  /** Accounts in the currency. While any exist, the decimals cannot change. */
  accountsCount?: number;
}>();

const open = defineModel<boolean>('open', { default: false });

const FORM_ID = 'custom-currency-form';
const CODE_PATTERN = /^[A-Z0-9]{2,16}$/;
const MAX_SYMBOL_LENGTH = 8;
const MAX_DECIMALS = 18;
const PREVIEW_AMOUNT = 1234.5;

interface CustomCurrencyForm {
  code: string;
  name: string;
  symbol: string;
  decimals: number | null;
}

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const currenciesStore = useCurrenciesStore();
const { currencies, isoCurrencies } = storeToRefs(currenciesStore);

const isEditing = computed(() => Boolean(props.currency));
// Decimals are fixed once a row holds an amount in the currency. Accounts are what the page
// knows about; transactions or templates alone are caught by the API's 409.
const isDecimalsLocked = computed(() => isEditing.value && (props.accountsCount ?? 0) > 0);

const buildFormState = (): CustomCurrencyForm => ({
  code: props.currency?.code ?? '',
  name: props.currency?.name ?? '',
  symbol: props.currency?.symbol ?? '',
  decimals: props.currency?.decimals ?? null,
});

const form = ref<CustomCurrencyForm>(buildFormState());
const formError = ref<string | null>(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.value = buildFormState();
  formError.value = null;
  resetValidation();
});

const onCodeInput = (value: string | number | null) => {
  form.value.code = String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
};

const validationRules = computed(() => ({
  code: {
    filled: helpers.withMessage(t('settings.currencies.custom.errors.codeRequired'), required),
    format: helpers.withMessage(
      t('settings.currencies.custom.errors.codeFormat'),
      (value: string) => !value || CODE_PATTERN.test(value),
    ),
    notIso: helpers.withMessage(
      t('settings.currencies.custom.errors.codeIsIso'),
      (value: string) => isEditing.value || !isoCurrencies.value.some((item) => item.code === value),
    ),
    notDefined: helpers.withMessage(
      t('settings.currencies.custom.errors.codeExists'),
      (value: string) => isEditing.value || !currencies.value.some((item) => item.currencyCode === value),
    ),
  },
  name: {
    filled: helpers.withMessage(
      t('settings.currencies.custom.errors.nameRequired'),
      (value: string) => value.trim().length > 0,
    ),
  },
  symbol: {
    maxLength: helpers.withMessage(
      t('settings.currencies.custom.errors.symbolTooLong'),
      (value: string) => value.trim().length <= MAX_SYMBOL_LENGTH,
    ),
  },
  decimals: {
    range: helpers.withMessage(
      t('settings.currencies.custom.errors.decimalsRange'),
      (value: number | null) => value !== null && Number.isInteger(value) && value >= 0 && value <= MAX_DECIMALS,
    ),
  },
}));

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  computed(() => ({ form: validationRules.value })),
);

// Shows what an amount will look like, so the effect of the decimals and the symbol is visible
// before saving.
const previewLabel = computed(() => {
  const { code, symbol, decimals } = form.value;
  if (!CODE_PATTERN.test(code) || decimals === null || decimals < 0 || decimals > MAX_DECIMALS) return '';

  const meta: CurrencyMeta = { decimals, symbol: symbol.trim() || null, isCustom: true };
  return formatUIAmount(PREVIEW_AMOUNT, { currency: code, meta });
});

const refreshAfterChange = async () => {
  await currenciesStore.loadCurrencies({ force: true });
  // Accounts and transactions carry the currency's metadata (symbol, name), so they refetch too.
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
  queryClient.invalidateQueries({
    predicate: (query) => query.queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange),
  });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates });
};

const { mutate, isPending } = useMutation({
  mutationFn: () => {
    const { code, name, symbol, decimals } = form.value;
    const payload = { name: name.trim(), symbol: symbol.trim() || null };

    if (props.currency) {
      return updateCustomCurrency({
        code: props.currency.code,
        ...payload,
        ...(decimals !== props.currency.decimals && decimals !== null ? { decimals } : {}),
      });
    }

    return createCustomCurrency({ code, ...payload, decimals: decimals! });
  },
  onSuccess: async () => {
    await refreshAfterChange();
    addSuccessNotification(
      isEditing.value
        ? t('settings.currencies.custom.successfullyUpdated')
        : t('settings.currencies.custom.successfullyCreated'),
    );
    open.value = false;
  },
  onError: (error) => {
    // The API explains the refusal (a decimals change or a code that is taken) in the user's language.
    formError.value =
      extractApiErrorMessage(error) ||
      (isEditing.value
        ? t('settings.currencies.custom.errors.updateFailed')
        : t('settings.currencies.custom.errors.createFailed'));
  },
});

const handleSubmit = () => {
  if (!isFormValid()) return;
  formError.value = null;
  mutate();
};
</script>
