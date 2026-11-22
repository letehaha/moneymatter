<template>
  <div class="grid gap-4" data-testid="rate-source-view">
    <RadioGroup
      :model-value="draft.source"
      :disabled="isPending"
      :aria-label="$t('settings.currencies.dialog.sourceView.title')"
      class="gap-2"
      data-testid="rate-source-options"
      @update:model-value="changeSource({ value: $event })"
    >
      <div
        v-for="option in CURRENCY_RATE_SOURCES"
        :key="option"
        :class="cn('rounded-lg border', draft.source === option ? 'border-primary bg-primary/5' : 'border-border')"
        :data-testid="`rate-source-option-${option}`"
      >
        <Label
          :for="`rate-source-option-${option}-radio`"
          :class="cn('flex items-start gap-3 p-3 font-normal', isPending ? 'cursor-not-allowed' : 'cursor-pointer')"
        >
          <RadioGroupItem
            :id="`rate-source-option-${option}-radio`"
            :value="option"
            class="mt-0.5"
            :data-testid="`rate-source-radio-${option}`"
          />
          <span class="grid min-w-0 gap-0.5">
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              {{ $t(`settings.currencies.dialog.sourceView.option.${option}`) }}
              <span
                v-if="draft.source === option && (option === 'coingecko' || option === 'http')"
                class="inline-flex"
                :data-testid="`rate-source-schedule-${option}`"
              >
                <HintIcon :content="$t(`settings.currencies.dialog.sourceView.schedule.${option}`)" />
              </span>
              <StatusBadge v-if="option === savedSource" variant="info" data-testid="rate-source-in-use">
                {{ $t('settings.currencies.dialog.sourceView.inUse') }}
              </StatusBadge>
              <StatusBadge
                v-if="option === 'coingecko' && isNotConfigured"
                variant="warning"
                data-testid="rate-source-not-available"
              >
                {{ $t('settings.currencies.dialog.sourceView.notAvailable') }}
              </StatusBadge>
              <StatusBadge v-else-if="option === 'http'" variant="neutral">
                {{ $t('settings.currencies.dialog.sourceView.advanced') }}
              </StatusBadge>
            </span>
            <span class="text-muted-foreground text-xs leading-5">
              {{ $t(`settings.currencies.dialog.sourceView.option.${option}Hint`) }}
            </span>
          </span>
        </Label>

        <div v-if="draft.source === option && option !== 'manual'" class="border-border/70 border-t p-3">
          <PegSourceForm
            v-if="option === 'peg'"
            v-model="draft.peg"
            :code="code"
            :errors="visibleErrors"
            :disabled="isPending"
          />

          <template v-else-if="option === 'coingecko'">
            <Callout v-if="isNotConfigured" variant="warning" data-testid="rate-source-not-configured">
              <span>{{ $t('settings.currencies.dialog.sourceView.unavailable') }}</span>
            </Callout>
            <CoingeckoSourceForm
              v-else
              v-model="draft.coingecko"
              :errors="visibleErrors"
              :disabled="isPending"
              @not-configured="isNotConfigured = true"
            />
          </template>

          <HttpSourceForm
            v-else
            v-model="draft.http"
            :code="code"
            :saved="saved"
            :errors="visibleErrors"
            :disabled="isPending"
          />
        </div>
      </div>
    </RadioGroup>

    <p v-if="note" class="text-muted-foreground flex items-start gap-2 text-sm" data-testid="rate-source-note">
      <InfoIcon class="text-primary-text mt-0.5 size-4 shrink-0" />
      <span>{{ note }}</span>
    </p>

    <Callout
      v-if="saveError"
      variant="destructive"
      :title="$t('settings.currencies.dialog.sourceView.saveFailedTitle')"
      data-testid="rate-source-error"
    >
      <p>{{ saveError.message }}</p>
      <p v-if="saveError.reason" class="mt-0.5 text-xs" data-testid="rate-source-error-reason">
        {{ $t(getTestFailureKey({ reason: saveError.reason })) }}
      </p>
    </Callout>

    <div class="border-border/70 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t pt-4">
      <p
        v-if="isPending && fetchingText"
        class="text-muted-foreground mr-auto flex items-center gap-2 text-sm"
        data-testid="rate-source-fetching"
      >
        <Loader2Icon class="size-4 shrink-0 animate-spin" />
        {{ fetchingText }}
      </p>
      <p
        v-else-if="isChanged && !isPending"
        class="text-muted-foreground mr-auto text-sm"
        data-testid="rate-source-dirty"
      >
        {{ $t('settings.currencies.dialog.sourceView.notSaved') }}
      </p>

      <div class="flex gap-2">
        <Button
          type="button"
          variant="outline"
          :disabled="isPending"
          data-testid="rate-source-cancel"
          @click="emit('cancel')"
        >
          {{ $t('common.actions.cancel') }}
        </Button>
        <Button
          type="button"
          :disabled="!isChanged || isUnavailableSelected || isMissingStoredRate || isPending"
          :loading="isPending"
          data-testid="rate-source-save"
          @click="handleSave"
        >
          {{ saveLabel }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { updateCurrencyRateSource } from '@/api/currencies';
import HintIcon from '@/components/common/hint-icon.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError, extractApiErrorMessage, isApiErrorWithCode, isHandledByApiClient } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { API_ERROR_CODES, CURRENCY_RATE_SOURCES, RATE_SOURCE_TEST_FAILURES } from '@bt/shared/types';
import { InfoIcon, Loader2Icon } from '@lucide/vue';
import { useMutation } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CoingeckoSourceForm from '../rate-source/coingecko-source-form.vue';
import HttpSourceForm from '../rate-source/http-source-form.vue';
import PegSourceForm from '../rate-source/peg-source-form.vue';
import {
  type SavedRateSource,
  buildDraft,
  buildRateSourceBody,
  getTestFailureKey,
  isCoingeckoConfig,
  isDraftChanged,
  validateDraft,
} from '../rate-source/rate-source-draft';
import { useRateHistory } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import { useRefreshAfterCurrencyChange } from '../use-refresh-after-currency-change';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
}>();

const emit = defineEmits<{
  saved: [];
  cancel: [];
  'update:dirty': [value: boolean];
  'update:saving': [value: boolean];
}>();

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const refreshAfterChange = useRefreshAfterCurrencyChange();

const code = computed(() => props.currency.currencyCode);
const saved = computed<SavedRateSource>(() => ({
  rateSource: props.currency.rateSource,
  rateSourceConfig: props.currency.rateSourceConfig,
}));
const savedSource = computed(() => saved.value.rateSource);

const draft = reactive(buildDraft({ saved: saved.value }));
const showErrors = ref(false);
// Latched: the coin search unmounts once its fields are replaced by the warning.
const isNotConfigured = ref(false);

const seedDraft = ({ from }: { from: SavedRateSource }) => {
  Object.assign(draft, buildDraft({ saved: from }));
  showErrors.value = false;
};

const {
  mutate,
  isPending,
  error: saveFailure,
  reset: clearSaveFailure,
} = useMutation({
  mutationFn: () => updateCurrencyRateSource({ code: code.value, body: buildRateSourceBody({ draft }) }),
  onSuccess: async (response) => {
    seedDraft({ from: { rateSource: response.rateSource, rateSourceConfig: response.rateSourceConfig } });
    addSuccessNotification(t('settings.currencies.rateSource.successfullySaved'));
    await refreshAfterChange();
    emit('saved');
  },
  onError: (error) => {
    if (isApiErrorWithCode(error, API_ERROR_CODES.cryptoProviderNotConfigured)) isNotConfigured.value = true;
    if (!(error instanceof ApiErrorResponseError)) {
      captureException({ error, context: { scope: 'currencies:save-rate-source' } });
    }
  },
});

// A synced source is saved only once its first fetch brings a rate; an HTTP one says why it did not.
const saveError = computed(() => {
  const error = saveFailure.value;
  if (
    !error ||
    isHandledByApiClient({ error }) ||
    isApiErrorWithCode(error, API_ERROR_CODES.cryptoProviderNotConfigured)
  ) {
    return null;
  }
  const reason = error instanceof ApiErrorResponseError ? error.data?.details?.reason : undefined;

  return {
    message: extractApiErrorMessage(error) || t('settings.currencies.rateSource.errors.saveFailed'),
    reason: RATE_SOURCE_TEST_FAILURES.find((item) => item === reason),
  };
});

// Re-seed whenever the saved source changes, so a saved HTTP source drops the typed header values
// and shows the names the API returned. Never reset the mutation here: it runs mid-onSuccess.
watch(
  () => JSON.stringify(saved.value),
  () => seedDraft({ from: saved.value }),
);

const changeSource = ({ value }: { value: unknown }) => {
  const source = CURRENCY_RATE_SOURCES.find((item) => item === value);
  if (!source) return;
  draft.source = source;
  showErrors.value = false;
  clearSaveFailure();
};

const errors = computed(() => validateDraft({ draft, saved: saved.value, code: code.value }));
const visibleErrors = computed(() => (showErrors.value ? errors.value : {}));
const isChanged = computed(() => isDraftChanged({ draft, saved: saved.value }));
const isUnavailableSelected = computed(() => draft.source === 'coingecko' && isNotConfigured.value);

const { rates, isFetched, isLoadingError } = useRateHistory({ code: props.currency.currencyCode });
// Only a peg values the currency without stored rates, so leaving one that has none for manual entry is refused.
const isMissingStoredRate = computed(
  () => draft.source === 'manual' && isFetched.value && !isLoadingError.value && !rates.value.length,
);

watch(isChanged, (value) => emit('update:dirty', value), { immediate: true });
watch(isPending, (value) => emit('update:saving', value));

const savedCoinId = computed(() => {
  const config = saved.value.rateSourceConfig;
  return saved.value.rateSource === 'coingecko' && isCoingeckoConfig(config) ? config.coinId : null;
});

const note = computed(() => {
  if (!isChanged.value || Object.keys(errors.value).length || isUnavailableSelected.value) return null;
  const base = 'settings.currencies.dialog.sourceView.note';

  switch (draft.source) {
    case 'manual':
      return isMissingStoredRate.value ? t(`${base}.manualNoRates`, { code: code.value }) : t(`${base}.manual`);
    case 'peg':
      return t(`${base}.peg`, {
        code: code.value,
        factor: draft.peg.factor.trim(),
        target: draft.peg.pegCurrency,
      });
    case 'coingecko': {
      const text = t(`${base}.coingecko`, {
        coin: draft.coingecko.coinLabel || draft.coingecko.coinId,
        code: code.value,
      });
      const isCoinChanged = savedCoinId.value !== null && savedCoinId.value !== draft.coingecko.coinId;
      return isCoinChanged ? `${text} ${t(`${base}.coingeckoCoinChanged`)}` : text;
    }
    case 'http':
      return t(`${base}.http`, { code: code.value });
    default:
      return null;
  }
});

const fetchingText = computed(() => {
  if (draft.source === 'coingecko') return t('settings.currencies.dialog.sourceView.downloading');
  if (draft.source === 'http') return t('settings.currencies.dialog.sourceView.fetchingToday');
  return null;
});

const saveLabel = computed(() => {
  if (isPending.value) return t('settings.currencies.dialog.sourceView.saving');
  if (saveError.value) return t('common.actions.retry');
  return t('common.actions.save');
});

const handleSave = () => {
  clearSaveFailure();
  if (Object.keys(errors.value).length) {
    showErrors.value = true;
    return;
  }
  mutate();
};
</script>
