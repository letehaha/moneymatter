<template>
  <div class="grid gap-4" data-testid="rate-source-coingecko-form">
    <div class="grid gap-3">
      <CoingeckoCoinSearch
        :label="$t('settings.currencies.rateSource.coingecko.searchLabel')"
        :placeholder="$t('settings.currencies.rateSource.coingecko.searchPlaceholder')"
        :selected-coin-id="model.coinId"
        :disabled="disabled"
        :error-message="errors.coinId ? $t(errors.coinId) : undefined"
        @select="selectCoin({ coin: $event })"
      />

      <p v-if="model.coinId" class="text-sm" data-testid="rate-source-selected-coin">
        {{ $t('settings.currencies.rateSource.coingecko.selected', { coin: model.coinLabel || model.coinId }) }}
      </p>
    </div>

    <SelectField
      :model-value="findOption({ options: isoOptions, value: model.quoteCurrency })"
      :values="isoOptions"
      with-search
      :label="$t('settings.currencies.rateSource.quoteLabel')"
      :placeholder="$t('settings.currencies.rateSource.quotePlaceholder')"
      :disabled="disabled"
      data-testid="rate-source-coingecko-quote"
      @update:model-value="model = { ...model, quoteCurrency: $event?.value ?? model.quoteCurrency }"
    />

    <p class="text-muted-foreground flex items-start gap-1 text-xs leading-5">
      <InfoIcon class="text-primary-text mt-1 size-3.5 shrink-0" />
      {{ $t('settings.currencies.rateSource.coingecko.hint') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import type { CoingeckoCoinSearchResult } from '@bt/shared/types';
import { InfoIcon } from '@lucide/vue';

import CoingeckoCoinSearch from '../coingecko-coin-search.vue';
import type { RateSourceDraft, RateSourceDraftErrors } from './rate-source-draft';
import { findOption, useCurrencyOptions } from './use-currency-options';

defineProps<{
  errors: RateSourceDraftErrors;
  disabled?: boolean;
}>();

const model = defineModel<RateSourceDraft['coingecko']>({ required: true });

const { isoOptions } = useCurrencyOptions({ excludeCode: () => '' });

// The coin's logo travels with the save, so the currency's icon becomes the coin's.
const selectCoin = ({ coin }: { coin: CoingeckoCoinSearchResult }) => {
  model.value = {
    ...model.value,
    coinId: coin.coinId,
    coinLabel: `${coin.name} (${coin.symbol.toUpperCase()})`,
    logoUrl: coin.logoUrl,
  };
};
</script>
