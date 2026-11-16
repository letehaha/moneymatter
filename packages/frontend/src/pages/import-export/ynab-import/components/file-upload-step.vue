<template>
  <div>
    <div class="mb-4">
      <h2 class="text-lg font-semibold">{{ $t('pages.importExport.ynabImport.fileUpload.stepTitle') }}</h2>
      <p class="text-muted-foreground text-sm">{{ $t('pages.importExport.ynabImport.fileUpload.description') }}</p>
    </div>

    <FileDropzone
      v-model="uploadedFile"
      accept=".csv,text/csv"
      :max-size="MAX_FILE_SIZE"
      :validator="validateFile"
      :disabled="store.isParsing"
      height="min-h-[200px]"
      @error="(msg) => (uploadError = msg)"
    >
      <template #hint>{{ $t('pages.importExport.ynabImport.fileUpload.maxSize') }}</template>
    </FileDropzone>

    <Callout v-if="uploadError" variant="destructive" class="mt-4">
      {{ uploadError }}
    </Callout>
    <Callout v-else-if="store.parseError" variant="destructive" class="mt-4">
      {{ store.parseError }}
    </Callout>

    <div v-if="uploadedFile" class="mt-6 flex justify-end">
      <UiButton :disabled="store.isParsing" @click="handleUpload">
        <template v-if="store.isParsing">
          <LoaderIcon class="size-4 animate-spin" />
          {{ $t('pages.importExport.ynabImport.fileUpload.parsing') }}
        </template>
        <template v-else>{{ $t('pages.importExport.ynabImport.fileUpload.continueToPreview') }}</template>
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FileDropzone } from '@/components/common/dropzone';
import { Button as UiButton } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useImportYnabStore } from '@/stores/import-ynab';
import { LoaderIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useImportYnabStore();
const { uploadedFile } = storeToRefs(store);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const uploadError = ref('');

watch(uploadedFile, (file) => {
  if (file) uploadError.value = '';
});

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return t('pages.importExport.ynabImport.fileUpload.errors.invalidFormat');
  }
  return null;
}

async function handleUpload() {
  if (!uploadedFile.value) return;
  uploadError.value = '';
  try {
    await store.parseFile(uploadedFile.value);
  } catch {
    // Store sets `parseError`; nothing extra to do here.
  }
}
</script>
