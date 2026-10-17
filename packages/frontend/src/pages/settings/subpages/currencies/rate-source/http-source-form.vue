<template>
  <div class="grid gap-4" data-testid="rate-source-http-form">
    <InputField
      :model-value="model.urlTemplate"
      :label="$t('settings.currencies.rateSource.http.urlLabel')"
      :placeholder="$t('settings.currencies.rateSource.http.urlPlaceholder')"
      :disabled="disabled"
      :error-message="errors.urlTemplate ? $t(errors.urlTemplate) : undefined"
      data-testid="rate-source-http-url"
      @update:model-value="updateField({ urlTemplate: String($event ?? '') })"
    />
    <p class="text-muted-foreground -mt-2 text-xs leading-5">
      {{ $t('settings.currencies.rateSource.http.urlHint', placeholderParams) }}
    </p>

    <div class="grid gap-3 @[26rem]/currencies:grid-cols-2">
      <InputField
        :model-value="model.jsonPath"
        :label="$t('settings.currencies.rateSource.http.pathLabel')"
        :placeholder="$t('settings.currencies.rateSource.http.pathPlaceholder')"
        :disabled="disabled"
        :error-message="errors.jsonPath ? $t(errors.jsonPath) : undefined"
        data-testid="rate-source-http-path"
        @update:model-value="updateField({ jsonPath: String($event ?? '') })"
      />

      <SelectField
        :model-value="findOption({ options: isoOptions, value: model.quoteCurrency })"
        :values="isoOptions"
        with-search
        :label="$t('settings.currencies.rateSource.quoteLabel')"
        :placeholder="$t('settings.currencies.rateSource.quotePlaceholder')"
        :disabled="disabled"
        data-testid="rate-source-http-quote"
        @update:model-value="updateField({ quoteCurrency: $event?.value ?? model.quoteCurrency })"
      />
    </div>

    <section class="grid gap-3" data-testid="rate-source-http-headers">
      <div>
        <h4 class="text-sm font-medium">{{ $t('settings.currencies.rateSource.http.headersTitle') }}</h4>
        <p class="text-muted-foreground mt-0.5 text-xs leading-5">
          {{ $t('settings.currencies.rateSource.http.headersHint') }}
        </p>
      </div>

      <template v-if="savedHeaderNames.length && model.headersMode !== 'replace'">
        <p class="text-sm" data-testid="rate-source-saved-headers">
          {{
            model.headersMode === 'clear'
              ? $t('settings.currencies.rateSource.http.headersWillBeRemoved')
              : $t('settings.currencies.rateSource.http.savedHeaders', { names: savedHeaderNames.join(', ') })
          }}
        </p>

        <div class="flex flex-wrap gap-2">
          <Button
            v-if="model.headersMode === 'clear'"
            type="button"
            variant="outline"
            size="sm"
            :disabled="disabled"
            data-testid="rate-source-keep-headers"
            @click="updateField({ headersMode: 'keep' })"
          >
            {{ $t('settings.currencies.rateSource.http.keepHeaders') }}
          </Button>
          <template v-else>
            <Button
              type="button"
              variant="outline"
              size="sm"
              :disabled="disabled"
              data-testid="rate-source-replace-headers"
              @click="startReplacingHeaders"
            >
              <PencilIcon class="size-4" />
              {{ $t('settings.currencies.rateSource.http.replaceHeaders') }}
            </Button>
            <Button
              type="button"
              variant="soft-destructive"
              size="sm"
              :disabled="disabled"
              data-testid="rate-source-clear-headers"
              @click="updateField({ headersMode: 'clear' })"
            >
              <Trash2Icon class="size-4" />
              {{ $t('settings.currencies.rateSource.http.clearHeaders') }}
            </Button>
          </template>
        </div>
      </template>

      <template v-else>
        <div
          v-for="(row, index) in model.headers"
          :key="row.id"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 @[26rem]/currencies:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          :data-testid="`rate-source-header-row-${index}`"
        >
          <InputField
            :model-value="row.name"
            class="col-span-2 @[26rem]/currencies:col-span-1"
            :label="index === 0 ? $t('settings.currencies.rateSource.http.headerNameLabel') : undefined"
            :placeholder="$t('settings.currencies.rateSource.http.headerNamePlaceholder')"
            :disabled="disabled"
            @update:model-value="updateHeader({ id: row.id, name: String($event ?? '') })"
          />
          <InputField
            :model-value="row.value"
            type="password"
            :label="index === 0 ? $t('settings.currencies.rateSource.http.headerValueLabel') : undefined"
            :placeholder="$t('settings.currencies.rateSource.http.headerValuePlaceholder')"
            :disabled="disabled"
            @update:model-value="updateHeader({ id: row.id, value: String($event ?? '') })"
          />
          <DesktopOnlyTooltip :content="$t('settings.currencies.rateSource.http.removeHeader')">
            <Button
              type="button"
              variant="ghost-destructive"
              size="icon"
              :disabled="disabled"
              :aria-label="$t('settings.currencies.rateSource.http.removeHeader')"
              @click="removeHeader({ id: row.id })"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>

        <p v-if="errors.headers" class="text-destructive-text text-xs" data-testid="rate-source-headers-error">
          {{ $t(errors.headers) }}
        </p>

        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="disabled || model.headers.length >= MAX_HTTP_HEADERS"
            data-testid="rate-source-add-header"
            @click="addHeader"
          >
            <PlusIcon class="size-4" />
            {{ $t('settings.currencies.rateSource.http.addHeader') }}
          </Button>
          <Button
            v-if="savedHeaderNames.length"
            type="button"
            variant="ghost"
            size="sm"
            :disabled="disabled"
            data-testid="rate-source-cancel-replace-headers"
            @click="updateField({ headersMode: 'keep', headers: [] })"
          >
            {{ $t('settings.currencies.rateSource.http.keepHeaders') }}
          </Button>
        </div>
      </template>
    </section>

    <div class="grid gap-3">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="disabled || isTesting || !canTest"
          :loading="isTesting"
          data-testid="rate-source-test"
          @click="runTest"
        >
          <FlaskConicalIcon class="size-4" />
          {{ $t('settings.currencies.rateSource.http.testButton') }}
        </Button>
      </div>

      <Callout v-if="testResult?.ok" variant="success" data-testid="rate-source-test-success">
        <span>
          {{
            $t('settings.currencies.rateSource.http.testSuccess', {
              date: testResult.date,
              code,
              rate: formatTestRate({ rate: testResult.rate }),
              quote: testResult.quoteCurrency,
            })
          }}
        </span>
      </Callout>
      <Callout v-else-if="testResult" variant="destructive" data-testid="rate-source-test-failure">
        <p class="font-medium">{{ $t(getTestFailureKey({ reason: testResult.reason })) }}</p>
        <p v-if="testResult.message" class="mt-0.5 text-xs break-words">{{ testResult.message }}</p>
      </Callout>
      <Callout v-else-if="testError" variant="destructive" data-testid="rate-source-test-error">
        <span>{{ testError }}</span>
      </Callout>
    </div>
  </div>
</template>

<script setup lang="ts">
import { testCurrencyRateSource } from '@/api/currencies';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { extractApiErrorMessage } from '@/js/errors';
import type { TestCurrencyRateSourceResponse } from '@bt/shared/types';
import { FlaskConicalIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { useMutation } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  HTTP_URL_PLACEHOLDERS,
  MAX_HTTP_HEADERS,
  type HttpHeaderRow,
  type RateSourceDraft,
  type RateSourceDraftErrors,
  buildTestBody,
  createHeaderRow,
  getTestFailureKey,
} from './rate-source-draft';
import { findOption, useCurrencyOptions } from './use-currency-options';

/** A previewed rate keeps its significant digits: a coin can be worth a tiny fraction of its quote. */
const TEST_RATE_MAX_FRACTION_DIGITS = 12;

const props = defineProps<{
  /** The custom currency being priced. */
  code: string;
  /** Names of the headers saved on the currency's HTTP source; their values are never available. */
  savedHeaderNames: string[];
  errors: RateSourceDraftErrors;
  disabled?: boolean;
}>();

const model = defineModel<RateSourceDraft['http']>({ required: true });

const { t } = useI18n();
const { isoOptions } = useCurrencyOptions({ excludeCode: () => '' });

// vue-i18n reads braces as interpolation, so the literal placeholders travel as parameters.
const [datePlaceholder, codePlaceholder, quotePlaceholder] = HTTP_URL_PLACEHOLDERS;
const placeholderParams = { date: datePlaceholder, code: codePlaceholder, quote: quotePlaceholder };

const canTest = computed(() => Boolean(model.value.urlTemplate.trim() && model.value.jsonPath.trim()));

const testResult = ref<TestCurrencyRateSourceResponse | null>(null);
const testError = ref<string | null>(null);

const updateField = (patch: Partial<RateSourceDraft['http']>) => {
  model.value = { ...model.value, ...patch };
  testResult.value = null;
  testError.value = null;
};

const startReplacingHeaders = () => updateField({ headersMode: 'replace', headers: [createHeaderRow()] });
const addHeader = () => updateField({ headers: [...model.value.headers, createHeaderRow()] });
const removeHeader = ({ id }: { id: number }) =>
  updateField({ headers: model.value.headers.filter((row) => row.id !== id) });
const updateHeader = ({ id, ...patch }: Partial<HttpHeaderRow> & { id: number }) =>
  updateField({ headers: model.value.headers.map((row) => (row.id === id ? { ...row, ...patch } : row)) });

const formatTestRate = ({ rate }: { rate: number }) =>
  rate.toLocaleString(undefined, { maximumFractionDigits: TEST_RATE_MAX_FRACTION_DIGITS });

const draftForTest = computed<RateSourceDraft>(() => ({
  source: 'http',
  peg: { pegCurrency: null, factor: '1' },
  coingecko: { coinId: '', coinLabel: '', quoteCurrency: model.value.quoteCurrency },
  http: model.value,
}));

const { mutate: runTest, isPending: isTesting } = useMutation({
  mutationFn: () => testCurrencyRateSource({ code: props.code, body: buildTestBody({ draft: draftForTest.value }) }),
  onMutate: () => {
    testResult.value = null;
    testError.value = null;
  },
  onSuccess: (result) => {
    testResult.value = result;
  },
  // A refused request (the rate limit, a body the API will not take) explains itself.
  onError: (error) => {
    testError.value = extractApiErrorMessage(error) || t('settings.currencies.rateSource.http.testUnavailable');
  },
});
</script>
