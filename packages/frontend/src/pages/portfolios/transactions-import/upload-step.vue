<script setup lang="ts">
import { estimateInvestmentImportCost, extractInvestmentTransactions } from '@/api/investment-transactions-import';
import AiEstimatedCost from '@/components/common/ai-estimated-cost.vue';
import { FileDropzone } from '@/components/common/dropzone';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent } from '@/components/lib/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { getApiErrorMessage } from '@/js/errors';
import type { InvestmentImportExtractionResult, InvestmentImportHolding } from '@bt/shared/types/investments';
import type { StatementCostEstimate, StatementCostEstimateFailure } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { ClipboardIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon, SparklesIcon } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { CsvParseLocalError, parseCsvLocally, type InvestmentImportParseCsvResult } from './parse-csv-local';

/** Decode the DataURL-stored base64 back to a UTF-8 string for client-side CSV parsing. */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

const props = defineProps<{ portfolioId: string }>();

const emit = defineEmits<{
  (e: 'extracted', payload: { holdings: InvestmentImportHolding[]; warnings: string[] }): void;
  (
    e: 'csvParsed',
    payload: { fileBase64: string; fileName: string; parseResult: InvestmentImportParseCsvResult },
  ): void;
}>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();

type ImportMode = 'ai' | 'csv';
const importMode = ref<ImportMode>('ai');

type InputMode = 'file' | 'paste';
const inputMode = ref<InputMode>('file');

const uploadedFile = ref<File | null>(null);
const pastedText = ref('');
const fileBase64 = ref<string | null>(null);

const costEstimate = ref<StatementCostEstimate | null>(null);
const estimateError = ref<string | null>(null);

watch(uploadedFile, (file) => {
  pastedText.value = '';
  costEstimate.value = null;
  estimateError.value = null;
  if (!file) {
    fileBase64.value = null;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
    fileBase64.value = result.split(',')[1] || result;
  };
  reader.readAsDataURL(file);
});

// Switching modes wipes any pending file/paste state so the user doesn't carry
// an AI-mode PDF into the CSV-only dropzone (and vice versa).
watch(importMode, () => {
  uploadedFile.value = null;
  pastedText.value = '';
  fileBase64.value = null;
  costEstimate.value = null;
  estimateError.value = null;
});

function encodePastedText() {
  fileBase64.value = btoa(unescape(encodeURIComponent(pastedText.value)));
  uploadedFile.value = null;
}

const isReadyToExtract = computed(() => {
  if (importMode.value === 'csv') return !!uploadedFile.value && !!fileBase64.value;
  if (inputMode.value === 'file') return !!uploadedFile.value && !!fileBase64.value;
  return pastedText.value.trim().length > 0;
});

const estimate = useMutation({
  mutationFn: () => {
    if (!fileBase64.value && inputMode.value === 'paste') encodePastedText();
    if (!fileBase64.value) throw new Error('No file selected');
    return estimateInvestmentImportCost({
      fileBase64: fileBase64.value,
    });
  },
  onSuccess: (result) => {
    if ('success' in result && (result as StatementCostEstimateFailure).success === false) {
      const failure = result as StatementCostEstimateFailure;
      estimateError.value = failure.error?.message ?? failure.suggestion ?? 'Failed to analyze file';
      costEstimate.value = null;
    } else {
      costEstimate.value = result as StatementCostEstimate;
      estimateError.value = null;
    }
  },
  onError: (err: Error) => {
    estimateError.value = getApiErrorMessage({
      e: err,
      t,
      conflictKey: 'investmentsImport.notifications.estimateFailed',
      fallbackKey: 'investmentsImport.notifications.estimateFailed',
    });
    costEstimate.value = null;
  },
});

const extractAbort = ref<AbortController | null>(null);

function abortExtract() {
  extractAbort.value?.abort();
  extractAbort.value = null;
}

const extract = useMutation({
  mutationFn: () => {
    if (!fileBase64.value && inputMode.value === 'paste') encodePastedText();
    if (!fileBase64.value) throw new Error('No file selected');
    abortExtract();
    extractAbort.value = new AbortController();
    return extractInvestmentTransactions(
      {
        fileBase64: fileBase64.value,
        defaultPortfolioId: props.portfolioId,
      },
      { signal: extractAbort.value.signal },
    );
  },
  onSuccess: (result: InvestmentImportExtractionResult) => {
    const holdings = result.holdings.map((h) => ({ ...h, transactions: h.transactions.map((tx) => ({ ...tx })) }));
    extractAbort.value = null;
    emit('extracted', { holdings, warnings: result.warnings });
  },
  onError: (err: Error) => {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    addNotification({
      text: getApiErrorMessage({
        e: err,
        t,
        conflictKey: 'investmentsImport.notifications.extractFailed',
        fallbackKey: 'investmentsImport.notifications.extractFailed',
      }),
      type: NotificationType.error,
    });
  },
});

const parseCsv = useMutation({
  mutationFn: async () => {
    if (!fileBase64.value) throw new Error('No file selected');
    const fileText = base64ToUtf8(fileBase64.value);
    return parseCsvLocally({ fileText });
  },
  onSuccess: (result: InvestmentImportParseCsvResult) => {
    emit('csvParsed', {
      fileBase64: fileBase64.value!,
      fileName: uploadedFile.value?.name ?? 'import.csv',
      parseResult: result,
    });
  },
  onError: (err: Error) => {
    // Surface our local parse errors verbatim — they're written for end users.
    // Anything else falls through to the generic i18n message.
    addNotification({
      text:
        err instanceof CsvParseLocalError
          ? err.message
          : getApiErrorMessage({
              e: err,
              t,
              conflictKey: 'investmentsImport.notifications.csvParseFailed',
              fallbackKey: 'investmentsImport.notifications.csvParseFailed',
            }),
      type: NotificationType.error,
    });
  },
});

function onDropzoneError(message: string) {
  addNotification({ text: message, type: NotificationType.error });
}

const isAnyMutationPending = computed(
  () => estimate.isPending.value || extract.isPending.value || parseCsv.isPending.value,
);

onBeforeUnmount(() => abortExtract());
</script>

<template>
  <Card class="overflow-hidden p-0">
    <!-- Mode toggle: AI (LLM-powered, costs tokens) vs CSV (manual column mapping, free). -->
    <div class="border-border/60 border-b px-5 py-4">
      <Tabs v-model="importMode">
        <TabsList class="bg-muted/60 h-9 gap-1 rounded-full p-1">
          <TabsTrigger
            value="ai"
            :disabled="isAnyMutationPending"
            class="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 text-xs font-medium data-[state=active]:shadow-sm"
          >
            <SparklesIcon class="size-3.5" />
            {{ $t('investmentsImport.upload.modeAi') }}
          </TabsTrigger>
          <TabsTrigger
            value="csv"
            :disabled="isAnyMutationPending"
            class="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 text-xs font-medium data-[state=active]:shadow-sm"
          >
            <FileSpreadsheetIcon class="size-3.5" />
            {{ $t('investmentsImport.upload.modeCsv') }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p class="text-muted-foreground mt-2 text-xs">
        {{
          importMode === 'ai' ? $t('investmentsImport.upload.modeAiHint') : $t('investmentsImport.upload.modeCsvHint')
        }}
      </p>
    </div>

    <!-- AI mode: existing file/paste tabs + cost estimate -->
    <template v-if="importMode === 'ai'">
      <div class="border-border/60 border-b px-5 py-4">
        <Tabs v-model="inputMode">
          <TabsList class="bg-muted/60 h-9 gap-1 rounded-full p-1">
            <TabsTrigger
              value="file"
              :disabled="extract.isPending.value"
              class="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 text-xs font-medium data-[state=active]:shadow-sm"
            >
              <FileTextIcon class="size-3.5" />
              {{ $t('investmentsImport.upload.fileTab') }}
            </TabsTrigger>
            <TabsTrigger
              value="paste"
              :disabled="extract.isPending.value"
              class="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground inline-flex items-center gap-1.5 rounded-full px-4 text-xs font-medium data-[state=active]:shadow-sm"
            >
              <ClipboardIcon class="size-3.5" />
              {{ $t('investmentsImport.upload.pasteTab') }}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <CardContent class="space-y-4 p-5">
        <FileDropzone
          v-if="inputMode === 'file'"
          v-model="uploadedFile"
          accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf"
          :disabled="extract.isPending.value"
          @error="onDropzoneError"
        >
          <template #hint>{{ $t('investmentsImport.upload.fileHintFormats') }}</template>
        </FileDropzone>

        <div v-else>
          <TextareaField
            v-model="pastedText"
            :placeholder="$t('investmentsImport.upload.pastePlaceholder')"
            :rows="10"
            :disabled="extract.isPending.value"
            class="font-mono text-sm"
          />
        </div>

        <!-- Cost estimate readout -->
        <div v-if="costEstimate" class="border-border/60 bg-muted/30 grid gap-2 rounded-lg border p-4 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ $t('investmentsImport.upload.estimatedCost') }}</span>
            <span class="text-base font-semibold tabular-nums">
              <AiEstimatedCost :estimate="costEstimate" />
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ $t('investmentsImport.upload.model') }}</span>
            <span class="font-mono text-xs">{{ costEstimate.modelName }}</span>
          </div>
        </div>
        <div v-if="estimateError" class="text-destructive-text text-sm">{{ estimateError }}</div>
      </CardContent>

      <div
        class="border-border/60 bg-muted/20 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-end"
      >
        <Button
          variant="ghost"
          size="sm"
          :disabled="!isReadyToExtract || estimate.isPending.value || extract.isPending.value"
          @click="estimate.mutate()"
        >
          <Loader2Icon v-if="estimate.isPending.value" class="size-4 animate-spin" />
          {{ $t('investmentsImport.upload.estimateButton') }}
        </Button>
        <Button :disabled="!isReadyToExtract || extract.isPending.value" @click="extract.mutate()">
          <Loader2Icon v-if="extract.isPending.value" class="size-4 animate-spin" />
          <SparklesIcon v-else class="size-4" />
          {{
            extract.isPending.value
              ? $t('investmentsImport.upload.extracting')
              : $t('investmentsImport.upload.extractButton')
          }}
        </Button>
      </div>
    </template>

    <!-- CSV mode: dropzone only; on continue we parse + transition to mapping -->
    <template v-else>
      <CardContent class="space-y-4 p-5">
        <FileDropzone
          v-model="uploadedFile"
          accept=".csv,text/csv"
          :disabled="parseCsv.isPending.value"
          @error="onDropzoneError"
        >
          <template #hint>{{ $t('investmentsImport.upload.csvHintFormats') }}</template>
        </FileDropzone>
      </CardContent>

      <div
        class="border-border/60 bg-muted/20 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-end"
      >
        <Button :disabled="!isReadyToExtract || parseCsv.isPending.value" @click="parseCsv.mutate()">
          <Loader2Icon v-if="parseCsv.isPending.value" class="size-4 animate-spin" />
          <FileSpreadsheetIcon v-else class="size-4" />
          {{
            parseCsv.isPending.value
              ? $t('investmentsImport.upload.parsingCsv')
              : $t('investmentsImport.upload.continueToMapping')
          }}
        </Button>
      </div>
    </template>
  </Card>
</template>
