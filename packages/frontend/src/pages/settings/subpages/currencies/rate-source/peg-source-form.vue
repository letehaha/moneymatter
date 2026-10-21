<template>
  <div class="grid gap-4" data-testid="rate-source-peg-form">
    <div class="grid gap-3 @[26rem]/currencies:grid-cols-2">
      <SelectField
        :model-value="findOption({ options: pegOptions, value: model.pegCurrency })"
        :values="pegOptions"
        with-search
        :label="$t('settings.currencies.rateSource.peg.currencyLabel')"
        :placeholder="$t('settings.currencies.rateSource.peg.currencyPlaceholder')"
        :disabled="disabled"
        :error-message="errors.pegCurrency ? $t(errors.pegCurrency) : undefined"
        data-testid="rate-source-peg-currency"
        @update:model-value="model = { ...model, pegCurrency: $event?.value ?? null }"
      />

      <InputField
        :model-value="model.factor"
        :label="$t('settings.currencies.rateSource.peg.factorLabel')"
        :placeholder="$t('settings.currencies.rateSource.peg.factorPlaceholder')"
        :disabled="disabled"
        :error-message="errors.factor ? $t(errors.factor) : undefined"
        data-testid="rate-source-peg-factor"
        @update:model-value="model = { ...model, factor: String($event ?? '') }"
      />
    </div>

    <p class="text-muted-foreground flex items-start gap-1 text-xs leading-5">
      <InfoIcon class="text-primary-text mt-1 size-3.5 shrink-0" />
      {{ $t('settings.currencies.rateSource.peg.hint', { code }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { InfoIcon } from '@lucide/vue';

import type { RateSourceDraft, RateSourceDraftErrors } from './rate-source-draft';
import { findOption, useCurrencyOptions } from './use-currency-options';

const props = defineProps<{
  /** The custom currency being priced. */
  code: string;
  errors: RateSourceDraftErrors;
  disabled?: boolean;
}>();

const model = defineModel<RateSourceDraft['peg']>({ required: true });

const { pegOptions } = useCurrencyOptions({ excludeCode: () => props.code });
</script>
