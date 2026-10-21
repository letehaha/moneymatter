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

      <div v-if="currency" class="grid gap-3" data-testid="custom-currency-logo">
        <div class="flex items-center gap-3">
          <CurrencyIcon :code="currency.code" size="size-8" :logo-url="logoUrl" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ $t('settings.currencies.custom.logo.label') }}</p>
            <p class="text-muted-foreground text-xs leading-5">{{ $t('settings.currencies.custom.logo.hint') }}</p>
          </div>
          <Button
            v-if="logoUrl"
            type="button"
            variant="outline"
            size="sm"
            :disabled="isPending"
            data-testid="custom-currency-logo-clear"
            @click="clearLogo"
          >
            {{ $t('settings.currencies.custom.logo.clear') }}
          </Button>
        </div>

        <!-- Enter in the search box looks a coin up; it must not submit the whole form. -->
        <div @keydown.enter.prevent>
          <CoingeckoCoinSearch
            :label="$t('settings.currencies.custom.logo.searchLabel')"
            :placeholder="$t('settings.currencies.custom.logo.searchPlaceholder')"
            :selected-coin-id="pickedCoinId"
            :disabled="isPending"
            @select="pickCoin({ coin: $event })"
          />
        </div>
      </div>

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
import CurrencyIcon from '@/components/common/currency-icon.vue';
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
import {
  CURRENCY_CODE_PATTERN,
  CUSTOM_CURRENCY_DECIMALS_MAX,
  CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH,
  type CoingeckoCoinSearchResult,
  type CurrencyMeta,
} from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CoingeckoCoinSearch from './coingecko-coin-search.vue';
import type { EditableCustomCurrency } from './types';
import { useRefreshAfterCurrencyChange } from './use-refresh-after-currency-change';

const props = defineProps<{
  /** The currency being edited; unset creates a new one. */
  currency?: EditableCustomCurrency | null;
  /** Accounts in the currency. While any exist, the decimals cannot change. */
  accountsCount?: number;
}>();

const open = defineModel<boolean>('open', { default: false });

const FORM_ID = 'custom-currency-form';
const PREVIEW_AMOUNT = 1234.5;

interface CustomCurrencyForm {
  code: string;
  name: string;
  symbol: string;
  decimals: number | null;
}

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
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

// The logo is kept apart from the form: it is sent only once the user changed it, so editing the
// other fields never rewrites (or clears) a logo the dialog did not touch.
const logoUrl = ref<string | null>(props.currency?.logoUrl ?? null);
const isLogoTouched = ref(false);
const pickedCoinId = ref<string | undefined>(undefined);

const resetLogo = () => {
  logoUrl.value = props.currency?.logoUrl ?? null;
  isLogoTouched.value = false;
  pickedCoinId.value = undefined;
};

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.value = buildFormState();
  formError.value = null;
  resetLogo();
  resetValidation();
});

// A coin without an image has nothing to pick, so it leaves the logo as it is.
const pickCoin = ({ coin }: { coin: CoingeckoCoinSearchResult }) => {
  if (!coin.logoUrl) return;

  logoUrl.value = coin.logoUrl;
  isLogoTouched.value = true;
  pickedCoinId.value = coin.coinId;
};

const clearLogo = () => {
  logoUrl.value = null;
  isLogoTouched.value = true;
  pickedCoinId.value = undefined;
};

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
      (value: string) => !value || CURRENCY_CODE_PATTERN.test(value),
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
      (value: string) => value.trim().length <= CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH,
    ),
  },
  decimals: {
    range: helpers.withMessage(
      t('settings.currencies.custom.errors.decimalsRange'),
      (value: number | null) =>
        value !== null && Number.isInteger(value) && value >= 0 && value <= CUSTOM_CURRENCY_DECIMALS_MAX,
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
  if (!CURRENCY_CODE_PATTERN.test(code) || decimals === null || decimals < 0 || decimals > CUSTOM_CURRENCY_DECIMALS_MAX)
    return '';

  const meta: CurrencyMeta = { decimals, symbol: symbol.trim() || null, isCustom: true };
  return formatUIAmount(PREVIEW_AMOUNT, { currency: code, meta });
});

const refreshAfterChange = useRefreshAfterCurrencyChange();

const { mutate, isPending } = useMutation({
  mutationFn: () => {
    const { code, name, symbol, decimals } = form.value;
    const payload = { name: name.trim(), symbol: symbol.trim() || null };

    if (props.currency) {
      return updateCustomCurrency({
        code: props.currency.code,
        ...payload,
        ...(decimals !== props.currency.decimals && decimals !== null ? { decimals } : {}),
        ...(isLogoTouched.value ? { logoUrl: logoUrl.value } : {}),
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
