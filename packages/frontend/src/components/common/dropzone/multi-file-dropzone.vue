<script setup lang="ts">
import DropzoneFileItem from './dropzone-file-item.vue';
import DropzoneSurface from './dropzone-surface.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { formatBytes } from '@/common/utils/format-bytes';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    /** Currently-selected files. v-model bound. Empty array means empty state. */
    modelValue: File[];
    /** Native `accept` attribute, e.g. `.csv,text/csv`. */
    accept?: string;
    /** Max size in bytes, applied per file. Larger files emit `error` and are skipped. */
    maxSize?: number;
    /** Per-file validator. Return an error string to reject a file, or null to accept. */
    validator?: (file: File) => string | null;
    /** Disables click + drop + paste + remove. */
    disabled?: boolean;
    /** Tailwind height class for the dropzone. */
    height?: string;
    /** Prompt shown at rest. Defaults to the CSV-worded shared string. */
    idleText?: string;
    /** Prompt shown while a drag is hovering. */
    dragText?: string;
  }>(),
  {
    accept: undefined,
    maxSize: undefined,
    validator: undefined,
    disabled: false,
    height: 'min-h-[200px]',
    idleText: undefined,
    dragText: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', files: File[]): void;
  (e: 'error', message: string): void;
}>();

const { t } = useI18n();

const files = computed<File[]>({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

/** Identity for de-duping repeat selections of the same file. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function validate(file: File): string | null {
  if (props.maxSize !== undefined && file.size > props.maxSize) {
    return t('fileDropzone.fileTooLargeNamed', { name: file.name, max: formatBytes({ bytes: props.maxSize }) });
  }
  if (!props.validator) return null;
  const result = props.validator(file);
  return typeof result === 'string' && result.length > 0 ? result : null;
}

/**
 * Appends valid, not-already-selected files to the current selection. Rejected
 * files surface their message via `error` (first one wins) and are skipped;
 * exact repeats are dropped silently so re-dropping a file is a no-op.
 */
function addFiles(incoming: File[]) {
  if (props.disabled) return;

  const seen = new Set(files.value.map(fileKey));
  const next = [...files.value];
  let firstError: string | null = null;

  for (const file of incoming) {
    const err = validate(file);
    if (err) {
      if (!firstError) firstError = err;
      continue;
    }
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(file);
  }

  // Emit unconditionally so a stale rejection message clears the moment a valid
  // selection lands — otherwise the Callout from an earlier bad file lingers over
  // good files. Empty string = no error.
  emit('error', firstError ?? '');
  files.value = next;
}

function removeAt(index: number) {
  const next = [...files.value];
  next.splice(index, 1);
  emit('error', '');
  files.value = next;
}

function clearAll() {
  emit('error', '');
  files.value = [];
}
</script>

<template>
  <div class="space-y-3">
    <DropzoneSurface
      :accept="accept"
      :disabled="disabled"
      :height="height"
      multiple
      :idle-text="idleText ?? t('fileDropzone.clickOrDragMultiple')"
      :drag-text="dragText ?? t('fileDropzone.dropHereMultiple')"
      @files="addFiles"
      @error="emit('error', $event)"
    >
      <template v-if="$slots.hint" #hint>
        <slot name="hint" />
      </template>
    </DropzoneSurface>

    <div v-if="files.length" class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <p class="text-muted-foreground text-xs font-medium">
          {{ t('fileDropzone.filesSelected', { count: files.length }, files.length) }}
        </p>
        <Button variant="ghost" size="sm" :disabled="disabled" @click="clearAll">
          {{ t('fileDropzone.clearAll') }}
        </Button>
      </div>

      <ScrollArea class="max-h-60" viewport-class="max-h-60">
        <ul class="space-y-2">
          <li v-for="(file, index) in files" :key="fileKey(file)">
            <DropzoneFileItem :file="file" :disabled="disabled" @remove="removeAt(index)" />
          </li>
        </ul>
      </ScrollArea>
    </div>
  </div>
</template>
