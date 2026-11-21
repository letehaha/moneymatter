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

      <div class="flex items-start gap-3">
        <LogoSquareField
          v-model="logo"
          :name-for-search="form.name"
          :reset-label="$t('common.logo.remove')"
          :tabs="ALL_LOGO_TABS"
          :disabled="isPending"
          align="with-labeled-field"
        >
          <template #placeholder>
            <span
              class="bg-muted-foreground/15 text-foreground inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm leading-none font-semibold tracking-tighter select-none"
              data-testid="custom-currency-logo-placeholder"
            >
              {{ placeholderMonogram }}
            </span>
          </template>
        </LogoSquareField>
        <div class="min-w-0 flex-1">
          <InputField
            v-model="form.name"
            :label="$t('settings.currencies.custom.nameLabel')"
            :placeholder="$t('settings.currencies.custom.namePlaceholder')"
            :error-message="getFieldErrorMessage('form.name')"
            data-testid="custom-currency-name"
            @blur="touchField('form.name')"
          />
        </div>
      </div>

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

      <Callout v-if="isDecimalsChanged" data-testid="custom-currency-decimals-warning">
        <span>{{ $t('settings.currencies.delete.foreignAmountsWarning') }}</span>
      </Callout>

      <template v-if="!isEditing">
        <InputField
          v-model="form.rate"
          type="number"
          only-positive
          :label="$t('settings.currencies.custom.rateLabel')"
          :placeholder="$t('settings.currencies.custom.ratePlaceholder')"
          :error-message="getFieldErrorMessage('form.rate')"
          data-testid="custom-currency-rate"
          @blur="touchField('form.rate')"
        />

        <p class="text-muted-foreground -mt-2 text-xs">{{ $t('settings.currencies.custom.createRateHint') }}</p>
      </template>

      <p v-if="previewLabel" class="text-muted-foreground text-sm tabular-nums" data-testid="custom-currency-preview">
        {{ $t('settings.currencies.custom.preview', { value: previewLabel }) }}
      </p>

      <Callout v-if="formError" variant="destructive" data-testid="custom-currency-error">
        <span>{{ formError }}</span>
      </Callout>

      <CurrencyBlockerList v-if="blockers.length" :blockers="blockers" />
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
import {
  ALL_LOGO_TABS,
  type LogoSelection,
  toLogoPatch,
  toLogoSelection,
  toOptionalLogoPayload,
} from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable/form-validator';
import { extractApiErrorMessage, isApiErrorWithCode, isHandledByApiClient } from '@/js/errors';
import { formatUIAmount } from '@/js/helpers';
import { currencyMonogram } from '@/js/helpers/currency-monogram';
import { helpers, required } from '@/js/helpers/validators';
import { useCurrenciesStore } from '@/stores';
import {
  API_ERROR_CODES,
  CURRENCY_CODE_PATTERN,
  CUSTOM_CURRENCY_DECIMALS_MAX,
  CUSTOM_CURRENCY_DECIMALS_MIN,
  CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH,
  type CurrencyInUseBlocker,
  type CurrencyInUseDetails,
  type CurrencyMeta,
} from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CurrencyBlockerList from './currency-blocker-list.vue';
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
  rate: number | null;
}

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const refreshAfterChange = useRefreshAfterCurrencyChange();
const currenciesStore = useCurrenciesStore();
const { currencies, isoCurrencies } = storeToRefs(currenciesStore);

const isEditing = computed(() => Boolean(props.currency));
// Decimals are fixed once a row holds an amount in the currency. Accounts are what the page
// knows about; the API refuses the change for any other row.
const isDecimalsLocked = computed(() => isEditing.value && (props.accountsCount ?? 0) > 0);

const buildFormState = (): CustomCurrencyForm => ({
  code: props.currency?.code ?? '',
  name: props.currency?.name ?? '',
  symbol: props.currency?.symbol ?? '',
  decimals: props.currency?.decimals ?? null,
  rate: null,
});

const form = ref<CustomCurrencyForm>(buildFormState());
const formError = ref<string | null>(null);
const blockers = ref<CurrencyInUseBlocker[]>([]);
const storedLogo = ref<LogoSelection | null>(props.currency ? toLogoSelection(props.currency) : null);
const logo = ref<LogoSelection | null>(storedLogo.value);

const placeholderMonogram = computed(() =>
  currencyMonogram({ code: form.value.code, symbol: form.value.symbol, maxLength: 3 }),
);

const isDecimalsInRange = (value: number | null): value is number =>
  value !== null &&
  Number.isInteger(value) &&
  value >= CUSTOM_CURRENCY_DECIMALS_MIN &&
  value <= CUSTOM_CURRENCY_DECIMALS_MAX;

const isDecimalsChanged = computed(
  () =>
    Boolean(props.currency) &&
    isDecimalsInRange(form.value.decimals) &&
    form.value.decimals !== props.currency!.decimals,
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.value = buildFormState();
  storedLogo.value = props.currency ? toLogoSelection(props.currency) : null;
  logo.value = storedLogo.value;
  formError.value = null;
  blockers.value = [];
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
    range: helpers.withMessage(t('settings.currencies.custom.errors.decimalsRange'), isDecimalsInRange),
  },
  rate: {
    positive: helpers.withMessage(
      t('settings.currencies.custom.errors.rateRequired'),
      (value: number | null) => isEditing.value || (value !== null && Number.isFinite(value) && value > 0),
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
  if (!CURRENCY_CODE_PATTERN.test(code) || !isDecimalsInRange(decimals)) return '';

  const meta: CurrencyMeta = { decimals, symbol: symbol.trim() || null, isCustom: true };
  return formatUIAmount(PREVIEW_AMOUNT, { currency: code, meta, fractionDigits: decimals });
});

const { mutate, isPending } = useMutation({
  mutationFn: () => {
    const { code, name, symbol, decimals, rate } = form.value;
    const payload = { name: name.trim(), symbol: symbol.trim() || null };

    if (props.currency) {
      return updateCustomCurrency({
        code: props.currency.code,
        ...payload,
        ...(isDecimalsChanged.value ? { decimals: decimals! } : {}),
        ...toLogoPatch({ selection: logo.value, stored: storedLogo.value }),
      });
    }

    return createCustomCurrency({
      code,
      ...payload,
      decimals: decimals!,
      rate: { value: rate! },
      ...toOptionalLogoPayload({ selection: logo.value }),
    });
  },
  onSuccess: () => {
    addSuccessNotification(
      isEditing.value
        ? t('settings.currencies.custom.successfullyUpdated')
        : t('settings.currencies.custom.successfullyCreated'),
    );
    open.value = false;
    void refreshAfterChange();
  },
  onError: (error) => {
    if (isHandledByApiClient({ error })) return;
    // The API explains the refusal (a decimals change or a code that is taken) in the user's language.
    formError.value =
      extractApiErrorMessage(error) ||
      (isEditing.value
        ? t('settings.currencies.custom.errors.updateFailed')
        : t('settings.currencies.custom.errors.createFailed'));
    blockers.value = isApiErrorWithCode(error, API_ERROR_CODES.currencyInUse)
      ? ((error.data.details as CurrencyInUseDetails | undefined)?.blockers ?? [])
      : [];
  },
});

const handleSubmit = () => {
  if (!isFormValid()) return;
  formError.value = null;
  blockers.value = [];
  mutate();
};
</script>
