<template>
  <div class="grid gap-4" data-testid="rate-source-http-form">
    <InputField
      :model-value="model.urlTemplate"
      :label="$t('settings.currencies.dialog.sourceView.http.address')"
      :placeholder="$t('settings.currencies.rateSource.http.urlPlaceholder')"
      :disabled="disabled"
      :error-message="errors.urlTemplate ? $t(errors.urlTemplate) : undefined"
      data-testid="rate-source-http-url"
      @update:model-value="updateField({ urlTemplate: String($event ?? '') })"
    />
    <p class="text-muted-foreground -mt-2 text-xs leading-5">
      {{ $t('settings.currencies.rateSource.http.urlHint', HTTP_URL_PLACEHOLDERS) }}
    </p>

    <div class="grid gap-3 @[26rem]/currencies:grid-cols-2">
      <InputField
        :model-value="model.jsonPath"
        :label="$t('settings.currencies.dialog.sourceView.http.path')"
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
      <h4 class="text-sm font-medium">
        {{ $t('settings.currencies.dialog.sourceView.http.headers') }}
        <span class="text-muted-foreground font-normal">
          · {{ $t('settings.currencies.dialog.sourceView.http.headersStored') }}
        </span>
      </h4>

      <template v-if="savedHeaderNames.length && model.headersMode === 'keep'">
        <p class="text-sm" data-testid="rate-source-saved-headers">
          {{ $t('settings.currencies.rateSource.http.savedHeaders', { names: savedHeaderNames.join(', ') }) }}
        </p>
        <Callout v-if="isOriginChanged" variant="warning" data-testid="rate-source-headers-origin-changed">
          <span>{{ $t('settings.currencies.rateSource.http.headersOriginChanged') }}</span>
        </Callout>

        <div>
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

        <p
          v-if="savedHeaderNames.length && !getFilledHeaderRows({ http: model }).length"
          class="text-sm"
          data-testid="rate-source-headers-removed"
        >
          {{ $t('settings.currencies.rateSource.http.headersWillBeRemoved') }}
        </p>
        <p v-if="errors.headers" class="text-destructive-text text-xs" data-testid="rate-source-headers-error">
          {{ $t(errors.headers) }}
        </p>

        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="disabled || model.headers.length >= HTTP_RATE_SOURCE_MAX_HEADERS"
            data-testid="rate-source-add-header"
            @click="addHeader"
          >
            <PlusIcon class="size-4" />
            {{ $t('settings.currencies.rateSource.http.addHeader') }}
          </Button>
          <Button
            v-if="savedHeaderNames.length && !isOriginChanged"
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
          {{
            testResult || testFailure
              ? $t('settings.currencies.dialog.sourceView.http.testAgain')
              : $t('settings.currencies.dialog.sourceView.http.test')
          }}
        </Button>
      </div>

      <Callout v-if="testResult?.ok" variant="success" data-testid="rate-source-test-success">
        <span>
          {{
            $t('settings.currencies.rateSource.http.testSuccess', {
              date: testResult.date,
              code,
              rate: toLocalNumber(testResult.rate, RATE_DISPLAY_OPTIONS),
              quote: testResult.quoteCurrency,
            })
          }}
        </span>
      </Callout>
      <Callout v-else-if="testResult" variant="destructive" data-testid="rate-source-test-failure">
        <p class="font-medium">{{ $t(getTestFailureKey({ reason: testResult.reason })) }}</p>
        <p v-if="testResult.message" class="mt-0.5 text-xs break-words">{{ testResult.message }}</p>
      </Callout>
      <Callout v-else-if="testFailure" variant="destructive" data-testid="rate-source-test-error">
        <span>
          {{ extractApiErrorMessage(testFailure) || $t('settings.currencies.rateSource.http.testUnavailable') }}
        </span>
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
import { toLocalNumber } from '@/js/helpers/formatters';
import { HTTP_RATE_SOURCE_MAX_HEADERS } from '@bt/shared/types';
import { FlaskConicalIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { useMutation } from '@tanstack/vue-query';
import { computed } from 'vue';

import { rateDisplayOptions } from '../rate-precision';
import {
  HTTP_URL_PLACEHOLDERS,
  type HttpHeaderRow,
  type RateSourceDraft,
  type RateSourceDraftErrors,
  type SavedRateSource,
  buildHttpConfig,
  createHeaderRow,
  getFilledHeaderRows,
  getSavedHeaderNames,
  getTestFailureKey,
  isHeadersOriginChanged,
} from './rate-source-draft';
import { findOption, useCurrencyOptions } from './use-currency-options';

const RATE_DISPLAY_OPTIONS = rateDisplayOptions({ isCustom: true, isoDecimals: 6 });

const props = defineProps<{
  /** The custom currency being priced. */
  code: string;
  saved: SavedRateSource;
  errors: RateSourceDraftErrors;
  disabled?: boolean;
}>();

const model = defineModel<RateSourceDraft['http']>({ required: true });

const { isoOptions } = useCurrencyOptions();

const savedHeaderNames = computed(() => getSavedHeaderNames({ saved: props.saved }));
const isOriginChanged = computed(() =>
  isHeadersOriginChanged({ http: model.value, saved: props.saved, code: props.code }),
);
const canTest = computed(() => Boolean(model.value.urlTemplate.trim() && model.value.jsonPath.trim()));

// Resetting detaches a preview still in flight, so its answer never shows for settings edited since.
const {
  mutate: runTest,
  isPending: isTesting,
  data: testResult,
  error: testFailure,
  reset: resetTest,
} = useMutation({
  mutationFn: () =>
    testCurrencyRateSource({
      code: props.code,
      body: { rateSource: 'http', config: buildHttpConfig({ http: model.value }) },
    }),
});

const updateField = (patch: Partial<RateSourceDraft['http']>) => {
  model.value = { ...model.value, ...patch };
  resetTest();
};

const startReplacingHeaders = () => updateField({ headersMode: 'replace', headers: [createHeaderRow()] });
const addHeader = () => updateField({ headers: [...model.value.headers, createHeaderRow()] });
const removeHeader = ({ id }: { id: number }) =>
  updateField({ headers: model.value.headers.filter((row) => row.id !== id) });
const updateHeader = ({ id, ...patch }: Partial<HttpHeaderRow> & { id: number }) =>
  updateField({ headers: model.value.headers.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
</script>
