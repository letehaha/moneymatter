<template>
  <div class="bg-card rounded-xl border">
    <!-- Body -->
    <div class="p-6">
      <div class="mb-4">
        <h2 class="text-lg font-semibold">{{ $t('pages.importExport.csvImport.fileUpload.stepTitle') }}</h2>
        <p class="text-muted-foreground text-sm">{{ $t('pages.importExport.csvImport.fileUpload.description') }}</p>
      </div>

      <MultiFileDropzone
        v-model="selectedFiles"
        accept=".csv,text/csv"
        :max-size="MAX_FILE_SIZE"
        :validator="validateFile"
        :disabled="isUploading"
        height="min-h-[200px]"
        @error="(msg) => (error = msg)"
      >
        <template #hint>{{ $t('pages.importExport.csvImport.fileUpload.maxSize') }}</template>
      </MultiFileDropzone>

      <Callout v-if="error" variant="destructive" class="mt-4">
        {{ error }}
      </Callout>
    </div>

    <!-- Self-contained footer — rendered only when at least one file is selected -->
    <div v-if="selectedFiles.length" class="border-t px-6 py-4">
      <div class="flex justify-end">
        <UiButton :disabled="isUploading" @click="handleUpload">
          <template v-if="isUploading">
            <LoaderIcon class="size-4 animate-spin" />
            {{ $t('pages.importExport.csvImport.fileUpload.parsing') }}
          </template>
          <template v-else>
            {{ $t('pages.importExport.csvImport.fileUpload.continueToMapping') }}
          </template>
        </UiButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MultiFileDropzone } from '@/components/common/dropzone';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { captureException } from '@/lib/sentry';
import { MergeCsvError } from '@/pages/import-export/utils/merge-csv-files';
import { useImportExportStore } from '@/stores/import-export';
import { MAX_CSV_ROWS } from '@bt/shared/types';
import { LoaderIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const importStore = useImportExportStore();

const selectedFiles = ref<File[]>([]);
const error = ref('');
const isUploading = ref(false);

function validateFile({ name }: File): string | null {
  if (!name.toLowerCase().endsWith('.csv')) {
    return t('pages.importExport.csvImport.fileUpload.errors.invalidFormatNamed', { name });
  }
  return null;
}

/** Maps a merge failure code to a localized, file-named message for the Callout. */
function mergeErrorMessage(err: MergeCsvError): string {
  const file = err.fileName ?? '';
  const prefix = 'pages.importExport.csvImport.fileUpload.errors.merge';
  switch (err.code) {
    case 'EMPTY_SELECTION':
      return t(`${prefix}.emptySelection`);
    case 'FILE_READ_FAILED':
      return t(`${prefix}.fileReadFailed`, { file });
    case 'FILE_EMPTY':
      return t(`${prefix}.fileEmpty`, { file });
    case 'FILE_NO_DATA_ROWS':
      return t(`${prefix}.fileNoDataRows`, { file });
    case 'HEADER_MISMATCH':
      return t(`${prefix}.headerMismatch`, { file });
    case 'FORBIDDEN_HEADER':
      return t(`${prefix}.forbiddenHeader`, { file });
    case 'TOO_MANY_ROWS':
      return t(`${prefix}.tooManyRows`, { max: err.meta?.max ?? MAX_CSV_ROWS });
    case 'PARSE_ERROR':
      return t(`${prefix}.parseError`, { file });
    default:
      // Exhaustiveness guard: a new MergeCsvErrorCode without a case above fails to
      // compile here rather than silently degrading to the generic message.
      err.code satisfies never;
      return t('pages.importExport.csvImport.fileUpload.errors.parseFailed');
  }
}

const handleUpload = async () => {
  if (!selectedFiles.value.length) return;

  isUploading.value = true;
  error.value = '';

  try {
    // parseFiles merges the selection, then internally calls goToStep('map') + markStepCompleted('upload')
    await importStore.parseFiles({ files: selectedFiles.value });
  } catch (err) {
    if (err instanceof MergeCsvError) {
      // Merge failures are user-fixable (bad/mismatched/empty files) — show the
      // specific, file-named reason. Not reported to Sentry: it's expected input.
      error.value = mergeErrorMessage(err);
    } else {
      // A non-merge failure means the backend parse call itself failed (network, 5xx).
      // Show a generic localized message rather than the raw error string (which leaks
      // unlocalized HTTP/stack text), and report it so the failure isn't silent.
      error.value = t('pages.importExport.csvImport.fileUpload.errors.parseFailed');
      captureException({ error: err, context: { scope: 'import-csv:parse-files' } });
    }
  } finally {
    isUploading.value = false;
  }
};
</script>
