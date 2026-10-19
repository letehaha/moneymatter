<template>
  <div class="@container/statement-upload space-y-6">
    <div class="space-y-3">
      <MultiFileDropzone
        :model-value="dropzoneFiles"
        accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,text/plain,image/jpeg,image/png,image/webp"
        :validator="validateSizeAndExtension"
        :disabled="isBusy"
        :idle-text="$t('pages.statementParser.uploadExtract.clickOrDragStatements')"
        @update:model-value="handleSelectionChange"
        @error="(msg) => (dropzoneError = msg)"
      >
        <template #hint>{{ $t('pages.statementParser.uploadExtract.supportedFormats') }}</template>
      </MultiFileDropzone>

      <div v-if="canReadClipboard" class="flex items-center justify-end gap-3">
        <span class="text-muted-foreground hidden text-xs [@media(hover:hover)]:inline">
          {{ $t('pages.statementParser.uploadExtract.pasteShortcutHint', { shortcut: pasteShortcut }) }}
        </span>
        <Button variant="outline" size="sm" :disabled="isBusy" @click="handlePasteFromClipboard">
          <ClipboardPasteIcon class="size-4" />
          {{ $t('pages.statementParser.uploadExtract.pasteImageButton') }}
        </Button>
      </div>
    </div>

    <Callout v-if="dropzoneError || fileError" variant="destructive">
      <p v-if="dropzoneError">{{ dropzoneError }}</p>
      <p v-if="fileError">{{ fileError }}</p>
    </Callout>

    <div v-if="fileRows.length" class="space-y-2">
      <p class="text-muted-foreground text-xs font-medium">
        {{ $t('pages.statementParser.uploadExtract.filesLabel') }}
      </p>
      <ul class="overflow-hidden rounded-lg border">
        <li v-for="row in fileRows" :key="row.id" class="px-3 py-2 text-sm not-last:border-b">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <Loader2Icon v-if="row.busy" class="text-primary-text size-4 shrink-0 animate-spin" />
              <CheckCircleIcon v-else-if="row.state === 'extracted'" class="text-success-text size-4 shrink-0" />
              <AlertCircleIcon v-else-if="row.failed" class="text-destructive-text size-4 shrink-0" />
              <FileTextIcon v-else class="text-muted-foreground size-4 shrink-0" />
              <span class="truncate">{{ row.name }}</span>
            </div>
            <span
              class="shrink-0 text-xs"
              :class="row.failed ? 'text-destructive-text' : 'text-muted-foreground'"
              :title="row.error ?? undefined"
            >
              {{ row.label }}
            </span>
          </div>

          <div
            v-if="row.needsPassword"
            class="mt-3 flex flex-col gap-3 @sm/statement-upload:flex-row @sm/statement-upload:items-end"
          >
            <div class="flex-1">
              <InputField
                v-model="passwords[row.id]"
                type="password"
                :label="$t('pages.statementParser.uploadExtract.pdfPasswordLabel')"
                :placeholder="$t('pages.statementParser.uploadExtract.pdfPasswordPlaceholder')"
                :disabled="isBusy"
                @keyup.enter.stop="handlePasswordSubmit({ id: row.id })"
              />
            </div>
            <Button :disabled="!passwords[row.id] || isBusy" @click="handlePasswordSubmit({ id: row.id })">
              <template v-if="store.isEstimating">
                <Loader2Icon class="size-4 animate-spin" />
              </template>
              {{ $t('pages.statementParser.uploadExtract.pdfPasswordSubmit') }}
            </Button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Cost Estimate Section -->
    <div v-if="pendingEstimateCount > 0 && !store.isExtracting" class="flex justify-center">
      <Button :disabled="isBusy" @click="store.estimateCosts()">
        <template v-if="store.isEstimating">
          <Loader2Icon class="size-4 animate-spin" />
          {{ $t('pages.statementParser.uploadExtract.analyzingFiles') }}
        </template>
        <template v-else>
          <CalculatorIcon class="size-4" />
          {{
            $t(
              'pages.statementParser.uploadExtract.analyzeButton',
              { count: pendingEstimateCount },
              pendingEstimateCount,
            )
          }}
        </template>
      </Button>
    </div>

    <Callout v-if="store.estimateFailures.length" variant="destructive">
      {{
        $t('pages.statementParser.uploadExtract.estimateFailedSome', {
          count: store.estimateFailures.length,
          total: store.fileEntries.length,
        })
      }}
      <ul class="mt-1 list-disc pl-5">
        <li v-for="entry in store.estimateFailures" :key="entry.id">
          {{ entry.file.name }} — {{ entry.estimateError }}
        </li>
      </ul>
      <Button v-if="!store.isEstimating" variant="ghost" size="sm" class="mt-2" @click="handleRetryEstimates">
        {{ $t('pages.statementParser.uploadExtract.tryAgain') }}
      </Button>
    </Callout>

    <div v-if="totals" class="space-y-4">
      <CostEstimateWarnings :estimated-input-tokens="totals.estimatedInputTokens" />

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="bg-muted rounded-lg p-3">
          <p class="text-muted-foreground text-sm">{{ $t('pages.statementParser.uploadExtract.modelLabel') }}</p>
          <p class="font-medium">{{ totals.modelName }}</p>
        </div>
        <div class="bg-muted rounded-lg p-3">
          <p class="text-muted-foreground text-sm">
            {{ $t('pages.statementParser.uploadExtract.estimatedCostLabel') }}
          </p>
          <p class="font-medium">
            <AiEstimatedCost :estimate="totals" />
          </p>
          <p v-if="totals.fileCount > 1" class="text-muted-foreground mt-0.5 text-xs">
            {{ $t('pages.statementParser.uploadExtract.totalForFiles', { count: totals.fileCount }) }}
          </p>
        </div>
        <div class="bg-muted rounded-lg p-3">
          <p class="text-muted-foreground text-sm">
            {{ $t('pages.statementParser.uploadExtract.estimatedTokensLabel') }}
          </p>
          <p class="font-medium">
            {{
              $t('pages.statementParser.uploadExtract.tokenFormat', {
                inputTokens: (totals.estimatedInputTokens / 1000).toFixed(1),
                outputTokens: (totals.estimatedOutputTokens / 1000).toFixed(1),
              })
            }}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <Button
          class="flex-1"
          :disabled="isBusy || !pendingExtractionCount || isReached({ feature: AI_FEATURE.statementParsing })"
          @click="store.extractAll()"
        >
          <template v-if="store.isExtracting">
            <Loader2Icon class="size-4 animate-spin" />
            {{ extractionStatus }}
          </template>
          <template v-else>
            <SparklesIcon class="size-4" />
            {{ $t('pages.statementParser.uploadExtract.extractButton') }}
          </template>
        </Button>
        <ApiKeySourceBadge :using-user-key="totals.usingUserKey" />
        <AiUsageBadge :feature="AI_FEATURE.statementParsing" />
      </div>

      <!-- Extraction Progress -->
      <div v-if="store.isExtracting" class="space-y-3">
        <div class="flex items-center gap-3">
          <div class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
            <div
              class="bg-primary h-full rounded-full transition-all duration-300 ease-out"
              :style="{ width: `${extractionProgress}%` }"
            />
          </div>
          <span class="text-muted-foreground w-10 text-right text-sm font-medium"> {{ extractionProgress }}% </span>
        </div>
        <p class="text-muted-foreground text-center text-xs">
          <template v-if="extractingPosition">
            {{
              $t('pages.statementParser.uploadExtract.progressFile', {
                name: extractingPosition.name,
                current: extractingPosition.current,
                total: extractingPosition.total,
              })
            }}
          </template>
          <template v-else>{{ $t('pages.statementParser.uploadExtract.progressMessage') }}</template>
        </p>
      </div>
    </div>

    <Callout v-if="store.extractionFailures.length" variant="destructive">
      {{
        $t('pages.statementParser.uploadExtract.extractionFailedSome', {
          count: store.extractionFailures.length,
          total: store.fileEntries.length,
        })
      }}
      <ul class="mt-1 list-disc pl-5">
        <li v-for="entry in store.extractionFailures" :key="entry.id">
          {{ entry.file.name }} — {{ entry.extractionError }}
        </li>
      </ul>
      <Button
        v-if="!store.isExtracting && !isReached({ feature: AI_FEATURE.statementParsing })"
        variant="ghost"
        size="sm"
        class="mt-2"
        @click="handleRetryFailed"
      >
        {{ $t('pages.statementParser.uploadExtract.retryFailed') }}
      </Button>
    </Callout>

    <!-- Extraction Results Preview -->
    <div v-if="store.mergedTransactions.length" class="space-y-4">
      <div class="bg-muted rounded-lg p-3">
        <p class="text-sm">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.uploadExtract.foundLabel') }}</span>
          <span class="font-medium">
            {{ store.mergedTransactions.length }}
            {{ $t('pages.statementParser.uploadExtract.transactions') }}</span
          >
          <span v-if="store.importSummary.files > 1" class="ml-1">
            {{ $t('pages.statementParser.uploadExtract.acrossFiles', { count: store.importSummary.files }) }}
          </span>
          <span v-if="store.detectedBankName" class="ml-2">
            <span class="text-muted-foreground">{{ $t('pages.statementParser.uploadExtract.fromLabel') }}</span>
            {{ store.detectedBankName }}
          </span>
          <span v-if="store.detectedCurrency" class="ml-2">
            <span class="text-muted-foreground">{{ $t('pages.statementParser.uploadExtract.inLabel') }}</span>
            {{ store.detectedCurrency }}
          </span>
        </p>
      </div>

      <Callout v-if="store.droppedRowCount > 0" variant="warning">
        {{ $t('pages.statementParser.droppedRowsWarning', { count: store.droppedRowCount }) }}
      </Callout>

      <Callout v-if="store.hasCurrencyConflict" variant="warning">
        {{
          $t('pages.statementParser.uploadExtract.currencyConflict', {
            currencies: store.detectedCurrencies.join(', '),
          })
        }}
      </Callout>

      <p class="text-muted-foreground text-center text-sm">
        {{ $t('pages.statementParser.uploadExtract.continueMessage') }}
      </p>

      <Button class="w-full" @click="store.goToStep('account')">
        {{ $t('pages.statementParser.uploadExtract.continueButton') }}
        <ArrowRightIcon class="size-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { logClientEvent } from '@/api/client-logs';
import { formatBytes } from '@/common/utils/format-bytes';
import { isMacPlatform } from '@/common/utils/platform';
import AiEstimatedCost from '@/components/common/ai-estimated-cost.vue';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import ApiKeySourceBadge from '@/components/common/api-key-source-badge.vue';
import { MultiFileDropzone } from '@/components/common/dropzone';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import {
  type StatementFileEntry,
  type StatementFileStatus,
  entryStatus,
  useStatementParserStore,
} from '@/stores/statement-parser';
import { AI_FEATURE } from '@bt/shared/types';
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CalculatorIcon,
  CheckCircleIcon,
  ClipboardPasteIcon,
  FileTextIcon,
  Loader2Icon,
  SparklesIcon,
} from '@lucide/vue';
import { useEventListener } from '@vueuse/core';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { imageFilesFromClipboardEvent, readClipboardImages } from '../utils/clipboard-images';
import {
  type FileRejectionReason,
  MAX_FILE_SIZE,
  SUPPORTED_EXTENSIONS,
  isImageFile,
  validateStatementFile,
} from '../utils/file-validation';
import { fitImageForUpload } from '../utils/fit-image-for-upload';
import CostEstimateWarnings from './cost-estimate-warnings.vue';

const { t } = useI18n();
const store = useStatementParserStore();
const { isReached } = useAiAllowance();

/** Sync rejections from the dropzone (size/extension); `fileError` holds our async content checks. */
const dropzoneError = ref('');
const fileError = ref('');
const passwords = ref<Record<string, string>>({});
const extractionStatus = ref('');
/** Progress within the file currently being extracted, 0-100. */
const fileProgress = ref(0);
const isIngesting = ref(false);

const dropzoneFiles = computed(() => store.fileEntries.map((entry) => entry.file));
const isBusy = computed(() => isIngesting.value || store.isEstimating || store.isExtracting);
const canReadClipboard = typeof navigator.clipboard?.read === 'function';
const pasteShortcut = isMacPlatform() ? '⌘V' : 'Ctrl+V';
const totals = computed(() => store.costEstimateTotals);

const pendingEstimateCount = computed(() => store.pendingEstimateEntries.length);
const pendingExtractionCount = computed(() => store.extractableEntries.length);

type FileRowState = StatementFileStatus | 'estimating' | 'extracting';

function rowState({ entry }: { entry: StatementFileEntry }): FileRowState {
  if (store.extractingFileId === entry.id) return 'extracting';
  if (store.estimatingFileId === entry.id) return 'estimating';
  return entryStatus({ entry });
}

const fileRows = computed(() =>
  store.fileEntries.map((entry) => {
    const state = rowState({ entry });
    return {
      id: entry.id,
      name: entry.file.name,
      state,
      busy: state === 'estimating' || state === 'extracting',
      failed: state === 'extractionFailed' || state === 'estimateFailed',
      needsPassword: entry.estimateErrorCode === 'PASSWORD_REQUIRED' || entry.estimateErrorCode === 'PASSWORD_INVALID',
      error: entry.extractionError ?? entry.estimateError,
      label:
        state === 'extracted'
          ? t(
              'pages.statementParser.uploadExtract.fileStatus.extracted',
              { count: entry.extraction!.transactions.length },
              entry.extraction!.transactions.length,
            )
          : t(`pages.statementParser.uploadExtract.fileStatus.${state === 'extractionFailed' ? 'failed' : state}`),
    };
  }),
);

/** Files that take part in the current extraction run (estimated, or already settled by it). */
const extractionRunEntries = computed(() =>
  store.fileEntries.filter((entry) => ['estimated', 'extracted', 'extractionFailed'].includes(entryStatus({ entry }))),
);

/** Position of the file being extracted, for the "3 of 5" progress caption. */
const extractingPosition = computed(() => {
  const index = extractionRunEntries.value.findIndex((entry) => entry.id === store.extractingFileId);
  if (index === -1) return null;
  return {
    name: extractionRunEntries.value[index]!.file.name,
    current: index + 1,
    total: extractionRunEntries.value.length,
  };
});

/** Settled files count as a whole slice each; the in-flight file adds its animated fraction. */
const extractionProgress = computed(() => {
  const total = extractionRunEntries.value.length;
  if (!total) return 0;
  const settled = extractionRunEntries.value.filter((entry) => entry.extraction || entry.extractionError).length;
  const inFlight = store.isExtracting ? fileProgress.value / 100 : 0;
  return Math.min(100, Math.round(((settled + inFlight) / total) * 100));
});

let progressInterval: ReturnType<typeof setInterval> | null = null;
let statusTimeouts: ReturnType<typeof setTimeout>[] = [];

watch(
  () => store.extractingFileId,
  (fileId) => {
    cleanupProgressAnimation();
    fileProgress.value = 0;
    if (!fileId) return;
    extractionStatus.value = t('pages.statementParser.uploadExtract.status.sendingFile');
    startProgressAnimation();
    scheduleStatusMessages();
  },
);

onUnmounted(() => {
  cleanupProgressAnimation();
});

function cleanupProgressAnimation() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  statusTimeouts.forEach(clearTimeout);
  statusTimeouts = [];
}

function startProgressAnimation() {
  fileProgress.value = 0;
  const startTime = Date.now();

  progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;

    // Logarithmic progress curve that slows down over time.
    // Caps at 95% so we never claim done before the server says so.
    fileProgress.value = Math.min(95, 100 * (1 - Math.exp(-elapsed / 25)));
  }, 200);
}

function scheduleStatusMessages() {
  // AI extraction typically takes 20-60 seconds per file — show progressive status messages.
  const statusUpdates = [
    { delay: 3000, message: t('pages.statementParser.uploadExtract.status.readingDocument') },
    { delay: 8000, message: t('pages.statementParser.uploadExtract.status.analyzingStructure') },
    { delay: 15000, message: t('pages.statementParser.uploadExtract.status.extractingData') },
    { delay: 25000, message: t('pages.statementParser.uploadExtract.status.processingTransactions') },
    { delay: 40000, message: t('pages.statementParser.uploadExtract.status.finalizing') },
    { delay: 55000, message: t('pages.statementParser.uploadExtract.status.almostDone') },
  ];

  statusTimeouts = statusUpdates.map(({ delay, message }) =>
    setTimeout(() => {
      if (store.isExtracting) extractionStatus.value = message;
    }, delay),
  );
}

/** Sync size and extension gate for the dropzone; the async magic-byte check runs in `handleSelectionChange`. */
function validateSizeAndExtension(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    logFileRejection({ file, reason: 'too_large' });
    return t('fileDropzone.fileTooLargeNamed', { name: file.name, max: formatBytes({ bytes: MAX_FILE_SIZE }) });
  }
  const ext = '.' + (file.name.toLowerCase().split('.').pop() || '');
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    logFileRejection({ file, reason: 'unsupported_extension' });
    return t('pages.statementParser.uploadExtract.unsupportedFileNamed', { name: file.name });
  }
  return null;
}

function fileRejectionMessage({ file, reason }: { file: File; reason: FileRejectionReason }): string {
  const name = file.name;
  switch (reason) {
    case 'unsupported_extension':
      return t('pages.statementParser.uploadExtract.unsupportedFileNamed', { name });
    case 'too_large':
      return t('fileDropzone.fileTooLargeNamed', { name, max: formatBytes({ bytes: MAX_FILE_SIZE }) });
    case 'invalid_pdf':
      return t('pages.statementParser.uploadExtract.invalidPdfNamed', { name });
    case 'invalid_image':
      return t('pages.statementParser.uploadExtract.invalidImageNamed', { name });
    case 'invalid_text':
      return t('pages.statementParser.uploadExtract.invalidTextNamed', {
        name,
        ext: (name.split('.').pop() ?? '').toUpperCase(),
      });
    case 'unreadable_image':
      return t('pages.statementParser.uploadExtract.unreadableImageNamed', { name });
    case 'unreadable':
      return t('pages.statementParser.uploadExtract.unreadableFiles', { files: name });
    default:
      reason satisfies never;
      return t('pages.statementParser.uploadExtract.unsupportedFileNamed', { name });
  }
}

function logFileRejection({
  file,
  reason,
  headerHex,
}: {
  file: File;
  reason: FileRejectionReason;
  headerHex?: string;
}) {
  logClientEvent({
    event: 'statement_import.file_rejected',
    level: 'warn',
    context: {
      reason,
      fileName: file.name.slice(0, 200),
      sizeBytes: file.size,
      mimeType: file.type.slice(0, 200) || null,
      headerHex: headerHex ?? null,
    },
  });
}

async function handleSelectionChange(files: File[]) {
  isIngesting.value = true;
  fileError.value = '';
  try {
    const accepted: File[] = [];
    const rejections: string[] = [];

    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (store.fileEntries.some((entry) => entry.id === key)) {
        accepted.push(file);
        continue;
      }
      const validation = await validateStatementFile({ file });
      if (!validation.valid) {
        rejections.push(fileRejectionMessage({ file, reason: validation.reason }));
        logFileRejection({ file, reason: validation.reason, headerHex: validation.headerHex });
        continue;
      }
      if (!isImageFile({ file })) {
        accepted.push(file);
        continue;
      }
      try {
        accepted.push(await fitImageForUpload({ file }));
      } catch {
        rejections.push(t('pages.statementParser.uploadExtract.unreadableImageNamed', { name: file.name }));
        logFileRejection({ file, reason: 'unreadable_image' });
      }
    }

    const { unreadable } = await store.setFiles({ files: accepted });
    for (const file of unreadable) logFileRejection({ file, reason: 'unreadable' });
    if (unreadable.length) {
      rejections.push(
        t('pages.statementParser.uploadExtract.unreadableFiles', {
          files: unreadable.map((file) => file.name).join(', '),
        }),
      );
    }

    if (rejections.length) fileError.value = rejections.join(' · ');
  } finally {
    isIngesting.value = false;
  }
}

function isEditableTarget({ target }: { target: EventTarget | null }): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function handlePaste(event: ClipboardEvent) {
  if (isBusy.value || isEditableTarget({ target: event.target })) return;
  const pasted = imageFilesFromClipboardEvent({ event });
  if (!pasted.length) return;
  event.preventDefault();
  void handleSelectionChange([...dropzoneFiles.value, ...pasted]);
}

useEventListener(document, 'paste', handlePaste);

async function handlePasteFromClipboard() {
  let pasted: File[];
  try {
    pasted = await readClipboardImages();
  } catch {
    fileError.value = t('pages.statementParser.uploadExtract.clipboardReadFailed');
    return;
  }
  if (!pasted.length) {
    fileError.value = t('pages.statementParser.uploadExtract.clipboardNoImage');
    return;
  }
  await handleSelectionChange([...dropzoneFiles.value, ...pasted]);
}

async function handlePasswordSubmit({ id }: { id: string }) {
  const password = passwords.value[id];
  if (!password) return;

  store.setDocumentPassword({ id, password });
  await store.estimateCosts();
}

async function handleRetryEstimates() {
  store.clearFailures({ phase: 'estimate' });
  await store.estimateCosts();
}

async function handleRetryFailed() {
  store.clearFailures({ phase: 'extract' });
  await store.extractAll();
}
</script>
