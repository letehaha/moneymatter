<template>
  <section class="grid gap-4" data-testid="rate-source-editor">
    <div>
      <h3 class="text-sm font-semibold">{{ $t('settings.currencies.rateSource.title') }}</h3>
      <p class="text-muted-foreground mt-0.5 text-xs leading-5">
        {{ $t('settings.currencies.rateSource.description', { code }) }}
      </p>
    </div>

    <PillTabs
      :items="sourceTabs"
      :model-value="draft.source"
      size="sm"
      full-width
      :disabled="isBusy"
      data-testid="rate-source-tabs"
      @update:model-value="changeSource"
    />

    <p class="text-muted-foreground text-xs leading-5" data-testid="rate-source-source-description">
      {{ $t(`settings.currencies.rateSource.sourceDescriptions.${draft.source}`, { code }) }}
    </p>

    <template v-if="draft.source === 'manual'">
      <ExchangeRateForm
        v-if="savedSource === 'manual'"
        :currency="currency"
        :is-form-disabled="isFormDisabled"
        @submit="emit('changed')"
        @trigger-disabled="emit('trigger-disabled', $event)"
      />
      <p v-else class="text-muted-foreground text-sm" data-testid="rate-source-manual-unsaved">
        {{ $t('settings.currencies.rateSource.manual.notSaved') }}
      </p>
    </template>

    <PegSourceForm
      v-else-if="draft.source === 'peg'"
      v-model="draft.peg"
      :code="code"
      :errors="visibleErrors"
      :disabled="isBusy"
    />

    <CoingeckoSourceForm
      v-else-if="draft.source === 'coingecko'"
      v-model="draft.coingecko"
      :errors="visibleErrors"
      :disabled="isBusy"
    />

    <HttpSourceForm
      v-else
      v-model="draft.http"
      :code="code"
      :saved="saved"
      :errors="visibleErrors"
      :disabled="isBusy"
    />

    <Callout v-if="isNotConfigured" variant="warning" data-testid="rate-source-not-configured">
      <span>{{ $t('settings.currencies.rateSource.coingecko.notConfigured') }}</span>
    </Callout>
    <Callout v-else-if="saveError" variant="destructive" data-testid="rate-source-error">
      <div>
        <p>{{ saveError.message }}</p>
        <p v-if="saveError.reason" class="mt-0.5 text-xs" data-testid="rate-source-error-reason">
          {{ $t(getTestFailureKey({ reason: saveError.reason })) }}
        </p>
      </div>
    </Callout>

    <div v-if="isChanged" class="flex justify-end">
      <Button type="button" :disabled="isBusy" :loading="isPending" data-testid="rate-source-save" @click="handleSave">
        {{ $t('settings.currencies.rateSource.saveButton') }}
      </Button>
    </div>

    <div class="bg-border/60 h-px w-full" />

    <RateHistoryList
      :currency="currency"
      :saved-source="savedSource"
      :is-form-disabled="isBusy"
      @changed="emit('changed')"
      @trigger-disabled="emit('trigger-disabled', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { updateCurrencyRateSource } from '@/api/currencies';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError, extractApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
import {
  API_ERROR_CODES,
  CURRENCY_RATE_SOURCES,
  type CurrencyRateSource,
  RATE_SOURCE_TEST_FAILURES,
} from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ExchangeRateForm from '../currency-row/exchange-rate-form.vue';
import type { CurrencyWithExchangeRate } from '../types';
import CoingeckoSourceForm from './coingecko-source-form.vue';
import HttpSourceForm from './http-source-form.vue';
import PegSourceForm from './peg-source-form.vue';
import RateHistoryList from './rate-history-list.vue';
import {
  type SavedRateSource,
  buildDraft,
  buildRateSourceBody,
  getTestFailureKey,
  isDraftChanged,
  validateDraft,
} from './rate-source-draft';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  /** A rate or the source was saved; currencies, rates and the amounts valued by them need a refresh. */
  changed: [];
  'trigger-disabled': [value: boolean];
}>();

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();

const code = computed(() => props.currency.currencyCode);
const saved = computed<SavedRateSource>(() => ({
  rateSource: props.currency.rateSource,
  rateSourceConfig: props.currency.rateSourceConfig,
}));
const savedSource = computed(() => saved.value.rateSource);

const draft = reactive(buildDraft({ saved: saved.value }));
const showErrors = ref(false);

const {
  mutate,
  isPending,
  error: saveFailure,
  reset: clearSaveFailure,
} = useMutation({
  mutationFn: () => updateCurrencyRateSource({ code: code.value, body: buildRateSourceBody({ draft }) }),
  onSuccess: (response) => {
    resetDraft({ from: { rateSource: response.rateSource, rateSourceConfig: response.rateSourceConfig } });
    addSuccessNotification(t('settings.currencies.rateSource.successfullySaved'));
    emit('changed');
  },
});

// An instance without a CoinGecko key answers 503; saying so beats a generic failure.
const isNotConfigured = computed(() =>
  isApiErrorWithCode(saveFailure.value, API_ERROR_CODES.cryptoProviderNotConfigured),
);
// A synced source is saved only once its first fetch brings a rate; an HTTP one says why it did not.
const saveError = computed(() => {
  const error = saveFailure.value;
  if (!error || isNotConfigured.value) return null;
  const reason = error instanceof ApiErrorResponseError ? error.data?.details?.reason : undefined;

  return {
    message: extractApiErrorMessage(error) || t('settings.currencies.rateSource.errors.saveFailed'),
    reason: RATE_SOURCE_TEST_FAILURES.find((item) => item === reason),
  };
});

const resetDraft = ({ from = saved.value }: { from?: SavedRateSource } = {}) => {
  Object.assign(draft, buildDraft({ saved: from }));
  showErrors.value = false;
  clearSaveFailure();
};

// Re-seed the draft whenever the saved source changes, so a saved HTTP source drops the typed
// header values and shows the names the API returned. A save that changes no public setting (new
// values for headers with the same names) leaves the saved source as it was, so the draft is also
// re-seeded from the response of the save itself.
watch(
  () => JSON.stringify(saved.value),
  () => resetDraft(),
);

const sourceTabs = computed(() =>
  CURRENCY_RATE_SOURCES.map((value) => ({ value, label: t(`settings.currencies.rateSource.sources.${value}`) })),
);

const changeSource = (value: string) => {
  draft.source = value as CurrencyRateSource;
  showErrors.value = false;
  clearSaveFailure();
};

const errors = computed(() => validateDraft({ draft, saved: saved.value, code: code.value }));
const visibleErrors = computed(() => (showErrors.value ? errors.value : {}));
const isChanged = computed(() => isDraftChanged({ draft, saved: saved.value }));

const isBusy = computed(() => isPending.value || props.isFormDisabled);

const handleSave = () => {
  clearSaveFailure();
  if (Object.keys(errors.value).length) {
    showErrors.value = true;
    return;
  }
  mutate();
};
</script>
