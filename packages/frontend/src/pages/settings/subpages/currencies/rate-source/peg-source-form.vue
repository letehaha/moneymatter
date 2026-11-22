<template>
  <div class="grid gap-3 @[26rem]/currencies:grid-cols-2" data-testid="rate-source-peg-form">
    <SelectField
      :model-value="findOption({ options: pegOptions, value: model.pegCurrency })"
      :values="pegOptions"
      with-search
      :label="$t('settings.currencies.dialog.sourceView.pegCurrency')"
      :placeholder="$t('settings.currencies.rateSource.peg.currencyPlaceholder')"
      :disabled="disabled"
      :error-message="errors.pegCurrency ? $t(errors.pegCurrency) : undefined"
      data-testid="rate-source-peg-currency"
      @update:model-value="model = { ...model, pegCurrency: $event?.value ?? null }"
    />

    <InputField
      :model-value="model.factor"
      :label="$t('settings.currencies.dialog.sourceView.pegAmount', { code })"
      :placeholder="$t('settings.currencies.rateSource.peg.factorPlaceholder')"
      :disabled="disabled"
      :error-message="errors.factor ? $t(errors.factor) : undefined"
      trailing-icon-css-class="px-3 text-muted-foreground text-sm"
      data-testid="rate-source-peg-factor"
      @update:model-value="model = { ...model, factor: String($event ?? '') }"
    >
      <template v-if="model.pegCurrency" #iconTrailing>
        <span data-testid="rate-source-peg-target">{{ model.pegCurrency }}</span>
      </template>
    </InputField>
  </div>
</template>

<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';

import type { RateSourceDraft, RateSourceDraftErrors } from './rate-source-draft';
import { findOption, useCurrencyOptions } from './use-currency-options';

defineProps<{
  /** The custom currency being priced. */
  code: string;
  errors: RateSourceDraftErrors;
  disabled?: boolean;
}>();

const model = defineModel<RateSourceDraft['peg']>({ required: true });

const { pegOptions } = useCurrencyOptions();
</script>
