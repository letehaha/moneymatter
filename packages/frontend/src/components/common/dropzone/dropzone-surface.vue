<!--
  Shared drag-and-drop surface for the file dropzones. Owns the dashed target, its
  drag visuals, the hidden file input, and the drag/drop/pick/paste mechanics — then
  hands the raw picked files up via `@files`. The wrapper above it (single- or multi-file)
  decides what to do with them, so this layer stays agnostic to selection shape.
  Pasting is offered only when `accept` lists an `image/*` type.
-->
<script setup lang="ts">
import {
  acceptListsImages,
  imageFilesFromClipboardEvent,
  isEditableTarget,
  readClipboardImages,
} from '@/common/utils/clipboard-images';
import { isMacPlatform } from '@/common/utils/platform';
import { Button } from '@/components/lib/ui/button';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { ClipboardPasteIcon, FileUpIcon } from '@lucide/vue';
import { useEventListener } from '@vueuse/core';
import { computed, ref, useId, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    /** Native `accept` attribute, e.g. `.csv,text/csv`. */
    accept?: string;
    /** Disables click + drop + paste. */
    disabled?: boolean;
    /** Native `multiple` attribute — lets the picker select more than one file. */
    multiple?: boolean;
    /** Tailwind height class for the dropzone. */
    height?: string;
    /** Prompt shown at rest. */
    idleText: string;
    /** Prompt shown while a drag is hovering. */
    dragText: string;
  }>(),
  {
    accept: undefined,
    disabled: false,
    multiple: false,
    height: 'min-h-[200px]',
  },
);

const emit = defineEmits<{
  (e: 'files', files: File[]): void;
  (e: 'error', message: string): void;
}>();

const { t } = useI18n();

const inputId = useId();
const isDragging = ref(false);

const canReadClipboard = typeof navigator.clipboard?.read === 'function';
const pasteShortcut = isMacPlatform() ? '⌘V' : 'Ctrl+V';
const acceptsImages = computed(() => acceptListsImages({ accept: props.accept }));
const labelRef = useTemplateRef<HTMLLabelElement>('label');

function emitFiles(list: FileList | null | undefined) {
  const files = list ? Array.from(list) : [];
  if (files.length) emit('files', files);
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  emitFiles(target.files);
  // Reset so re-selecting the same file fires `change` again.
  target.value = '';
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (props.disabled) return;
  isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (props.disabled) return;
  emitFiles(e.dataTransfer?.files);
}

function onPaste(e: ClipboardEvent) {
  if (props.disabled || !acceptsImages.value || isEditableTarget({ target: e.target })) return;
  // Paste listens on `document`, so a surface behind a modal would also receive it. Modals mark
  // everything outside them aria-hidden.
  if (labelRef.value?.closest('[aria-hidden="true"]')) return;
  const pasted = imageFilesFromClipboardEvent({ event: e });
  if (!pasted.length) return;
  e.preventDefault();
  emit('files', pasted);
}

useEventListener(document, 'paste', onPaste);

async function pasteFromClipboard() {
  let pasted: File[];
  try {
    pasted = await readClipboardImages();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
      captureException({ error, context: { scope: 'dropzone:clipboard-read' } });
    }
    emit('error', t('common.pasteImage.readFailed'));
    return;
  }
  if (props.disabled) return;
  if (!pasted.length) {
    emit('error', t('common.pasteImage.noImage'));
    return;
  }
  emit('files', pasted);
}
</script>

<template>
  <label
    ref="label"
    :for="inputId"
    :class="
      cn(
        'group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-4 text-sm transition-all',
        props.height,
        disabled ? 'border-input pointer-events-none opacity-60' : 'cursor-pointer',
        isDragging
          ? 'border-primary bg-primary/10 scale-[1.01]'
          : 'border-input hover:border-primary/60 hover:bg-primary/5',
      )
    "
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <slot name="empty" :is-dragging="isDragging">
      <div
        :class="
          cn(
            'flex size-14 items-center justify-center rounded-2xl transition-all',
            isDragging
              ? 'bg-primary/20 ring-primary/40 scale-110 ring-2'
              : 'bg-primary/10 ring-primary/10 ring-1 group-hover:scale-105',
          )
        "
      >
        <FileUpIcon class="text-primary-text size-7" />
      </div>
      <div class="space-y-1 text-center">
        <p class="text-sm font-medium">
          {{ isDragging ? dragText : idleText }}
        </p>
        <p v-if="$slots.hint" class="text-muted-foreground text-xs">
          <slot name="hint" />
        </p>
      </div>
      <div v-if="acceptsImages" class="flex flex-wrap items-center justify-center gap-3">
        <Button
          v-if="canReadClipboard"
          type="button"
          variant="outline"
          size="sm"
          :disabled="disabled"
          @click.prevent="pasteFromClipboard"
        >
          <ClipboardPasteIcon class="size-4" />
          {{ $t('common.pasteImage.button') }}
        </Button>
        <span class="text-muted-foreground hidden text-xs [@media(hover:hover)]:inline">
          {{ $t('common.pasteImage.shortcutHint', { shortcut: pasteShortcut }) }}
        </span>
      </div>
    </slot>
  </label>

  <input
    :id="inputId"
    type="file"
    class="hidden"
    :multiple="multiple"
    :accept="accept"
    :disabled="disabled"
    @change="onFileChange"
  />
</template>
