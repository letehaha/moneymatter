<script setup lang="ts">
import DropzoneFileItem from './dropzone-file-item.vue';
import DropzoneSurface from './dropzone-surface.vue';
import { formatBytes } from '@/common/utils/format-bytes';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    /** Currently-selected file. v-model bound. `null` means empty state. */
    modelValue: File | null;
    /** Native `accept` attribute, e.g. `.csv,.pdf,text/csv,application/pdf`. */
    accept?: string;
    /** Max size in bytes. Files larger than this emit `error` instead of being set. */
    maxSize?: number;
    /** Custom validator. Return an error string to reject the file, or null to accept. */
    validator?: (file: File) => string | null;
    /** Disables click + drop + paste + remove. */
    disabled?: boolean;
    /** Tailwind height class for the dropzone. Default `h-48`. */
    height?: string;
  }>(),
  {
    accept: undefined,
    maxSize: undefined,
    validator: undefined,
    disabled: false,
    height: 'h-48',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', file: File | null): void;
  (e: 'error', message: string): void;
}>();

const { t } = useI18n();

const acceptedFile = computed<File | null>({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

function validate(file: File): string | null {
  if (props.maxSize !== undefined && file.size > props.maxSize) {
    return t('fileDropzone.fileTooLarge', { max: formatBytes({ bytes: props.maxSize }) });
  }
  if (!props.validator) return null;
  const result = props.validator(file);
  // Only treat a non-empty string as a rejection — a validator that returns
  // `undefined` (or `""`) must not slip past a truthy check and silently accept.
  return typeof result === 'string' && result.length > 0 ? result : null;
}

/** Single-file dropzone: keep the first file, warn when several are dropped at once. */
function onFiles(files: File[]) {
  if (files.length > 1) {
    // Dropping three files and seeing only one accepted looks like a bug — say so.
    emit('error', t('fileDropzone.onlyFirstFileTaken'));
  }
  const file = files[0];
  if (!file) return;
  const err = validate(file);
  if (err) {
    emit('error', err);
    return;
  }
  acceptedFile.value = file;
}

function clear() {
  acceptedFile.value = null;
}
</script>

<template>
  <div class="space-y-3">
    <DropzoneSurface
      :accept="accept"
      :disabled="disabled"
      :height="height"
      :idle-text="t('fileDropzone.clickOrDrag')"
      :drag-text="t('fileDropzone.dropHere')"
      @files="onFiles"
      @error="emit('error', $event)"
    >
      <template v-if="$slots.empty" #empty="{ isDragging }">
        <slot name="empty" :is-dragging="isDragging" />
      </template>
      <template v-if="$slots.hint" #hint>
        <slot name="hint" />
      </template>
    </DropzoneSurface>

    <slot name="selected" :file="acceptedFile" :clear="clear">
      <DropzoneFileItem v-if="acceptedFile" :file="acceptedFile" :disabled="disabled" @remove="clear" />
    </slot>
  </div>
</template>
