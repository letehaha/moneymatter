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
        @submit="handleRateSubmit"
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
      :saved-header-names="savedHeaderNames"
      :errors="visibleErrors"
      :disabled="isBusy"
    />

    <Callout v-if="isNotConfigured" variant="warning" data-testid="rate-source-not-configured">
      <span>{{ $t('settings.currencies.rateSource.coingecko.notConfigured') }}</span>
    </Callout>
    <Callout v-else-if="saveError" variant="destructive" data-testid="rate-source-error">
      <span>{{ saveError }}</span>
    </Callout>

    <div v-if="isChanged" class="flex justify-end">
      <Button type="button" :disabled="isBusy" :loading="isPending" data-testid="rate-source-save" @click="handleSave">
        {{ $t('settings.currencies.rateSource.saveButton') }}
      </Button>
    </div>

    <div class="bg-border/60 h-px w-full" />

    <RateHistoryList
      :code="code"
      :saved-source="savedSource"
      :is-form-disabled="isBusy"
      @changed="emit('submit')"
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
import { API_ERROR_CODES } from '@bt/shared/types';
import { extractApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
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
  EDITABLE_RATE_SOURCES,
  type EditableRateSource,
  type SavedRateSource,
  buildDraft,
  buildRateSourceBody,
  getSavedHeaderNames,
  isDraftChanged,
  validateDraft,
} from './rate-source-draft';
import { useInvalidateRateHistory } from './use-rate-history';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  /** A manual rate was saved or removed. */
  submit: [];
  'trigger-disabled': [value: boolean];
  /** The source was saved; currencies, rates and the amounts valued by them need a refresh. */
  changed: [];
}>();

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const invalidateRateHistory = useInvalidateRateHistory();

const code = computed(() => props.currency.currencyCode);
const saved = computed(() => ({
  rateSource: props.currency.rateSource,
  rateSourceConfig: props.currency.rateSourceConfig,
}));
// A custom currency has no market feed, so one that was never given a source is priced by hand.
const savedSource = computed<EditableRateSource>(() => buildDraft({ saved: saved.value }).source);
const savedHeaderNames = computed(() => getSavedHeaderNames({ saved: saved.value }));

const draft = reactive(buildDraft({ saved: saved.value }));
const showErrors = ref(false);
const saveError = ref<string | null>(null);
const isNotConfigured = ref(false);

const resetDraft = ({ from = saved.value }: { from?: SavedRateSource } = {}) => {
  Object.assign(draft, buildDraft({ saved: from }));
  showErrors.value = false;
  saveError.value = null;
  isNotConfigured.value = false;
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
  EDITABLE_RATE_SOURCES.map((value) => ({ value, label: t(`settings.currencies.rateSource.sources.${value}`) })),
);

const changeSource = (value: string) => {
  draft.source = value as EditableRateSource;
  showErrors.value = false;
  saveError.value = null;
  isNotConfigured.value = false;
};

const errors = computed(() => validateDraft({ draft }));
const visibleErrors = computed(() => (showErrors.value ? errors.value : {}));
const isChanged = computed(() => isDraftChanged({ draft, saved: saved.value }));

const { mutate, isPending } = useMutation({
  mutationFn: () => updateCurrencyRateSource({ code: code.value, body: buildRateSourceBody({ draft }) }),
  onSuccess: (response) => {
    resetDraft({ from: { rateSource: response.rateSource, rateSourceConfig: response.rateSourceConfig } });
    addSuccessNotification(t('settings.currencies.rateSource.successfullySaved'));
    // A synced source stores rates of its own, and a peg or a switch back to manual changes how the kept ones apply.
    invalidateRateHistory({ code: code.value });
    emit('changed');
  },
  onError: (error) => {
    // An instance without a CoinGecko key answers 503; saying so beats a generic failure.
    if (isApiErrorWithCode(error, API_ERROR_CODES.cryptoProviderNotConfigured)) {
      isNotConfigured.value = true;
      return;
    }
    saveError.value = extractApiErrorMessage(error) || t('settings.currencies.rateSource.errors.saveFailed');
  },
});

const handleRateSubmit = () => {
  invalidateRateHistory({ code: code.value });
  emit('submit');
};

const isBusy = computed(() => isPending.value || props.isFormDisabled);

const handleSave = () => {
  saveError.value = null;
  isNotConfigured.value = false;
  if (Object.keys(errors.value).length) {
    showErrors.value = true;
    return;
  }
  mutate();
};
</script>
