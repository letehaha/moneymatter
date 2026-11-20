<template>
  <div>
    <div class="mb-4">
      <h2 class="text-lg font-semibold">
        {{ $t('pages.importExport.budgetBakersWalletImport.fileUpload.stepTitle') }}
      </h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.budgetBakersWalletImport.fileUpload.description') }}
      </p>
    </div>

    <MultiFileDropzone
      v-model="selectedFiles"
      accept=".csv,text/csv"
      :max-size="MAX_FILE_SIZE"
      :validator="validateFile"
      :disabled="isUploading"
      height="min-h-[200px]"
      @error="(msg) => (uploadError = msg)"
    >
      <template #hint>{{ $t('pages.importExport.budgetBakersWalletImport.fileUpload.maxSize') }}</template>
    </MultiFileDropzone>

    <Callout v-if="uploadError" variant="destructive" class="mt-4" role="alert">
      {{ uploadError }}
    </Callout>
    <Callout v-else-if="store.parseError" variant="destructive" class="mt-4" role="alert">
      {{ store.parseError }}
    </Callout>

    <!-- Footer — rendered only once at least one file is selected. Parsing is an
         explicit action (no auto-advance on drop) so the user can review/adjust
         the selection first, matching the CSV importer. -->
    <div v-if="selectedFiles.length" class="mt-6 flex justify-end">
      <UiButton :disabled="isUploading" @click="handleUpload">
        <template v-if="isUploading">
          <LoaderIcon class="size-4 animate-spin" />
          {{ $t('pages.importExport.budgetBakersWalletImport.fileUpload.parsing') }}
        </template>
        <template v-else>
          {{ $t('pages.importExport.budgetBakersWalletImport.fileUpload.continue') }}
        </template>
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MultiFileDropzone } from '@/components/common/dropzone';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { MergeCsvError } from '@/pages/import-export/utils/merge-csv-files';
import { useImportBudgetBakersWalletStore } from '@/stores/import-budget-bakers-wallet';
import { BUDGET_BAKERS_WALLET_MAX_ROWS } from '@bt/shared/types';
import { LoaderIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useImportBudgetBakersWalletStore();

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const selectedFiles = ref<File[]>([]);
const uploadError = ref('');
/** True for the whole merge + parse round-trip, gating the button and dropzone. */
const isUploading = ref(false);

function validateFile({ name }: File): string | null {
  if (!name.toLowerCase().endsWith('.csv')) {
    return t('pages.importExport.budgetBakersWalletImport.fileUpload.errors.invalidFormatNamed', { name });
  }
  return null;
}

/** Maps a merge failure code to a localized, file-named message for the Callout. */
function mergeErrorMessage(err: MergeCsvError): string {
  const file = err.fileName ?? '';
  const prefix = 'pages.importExport.budgetBakersWalletImport.fileUpload.errors.merge';
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
      return t(`${prefix}.tooManyRows`, { max: err.meta?.max ?? BUDGET_BAKERS_WALLET_MAX_ROWS });
    case 'PARSE_ERROR':
      return t(`${prefix}.parseError`, { file });
    default:
      // Exhaustiveness guard: a new MergeCsvErrorCode without a case above fails to
      // compile here rather than silently degrading to the generic message.
      err.code satisfies never;
      return t('pages.importExport.budgetBakersWalletImport.fileUpload.errors.parseFailed');
  }
}

/** Merge + parse the selection on demand; the store advances to resolve on success. */
async function handleUpload() {
  if (!selectedFiles.value.length) return;

  isUploading.value = true;
  uploadError.value = '';

  try {
    await store.parseFiles({ files: selectedFiles.value });
  } catch (err) {
    if (err instanceof MergeCsvError) {
      // User-fixable merge problems (bad/mismatched/empty files) — show the
      // specific, file-named reason in the local Callout.
      uploadError.value = mergeErrorMessage(err);
    }
    // A non-merge failure is a backend parse error; the store has already set
    // `parseError`, rendered by the second Callout above.
  } finally {
    isUploading.value = false;
  }
}
</script>
