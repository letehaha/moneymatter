<script setup lang="ts">
import { loadChatAttachmentImage } from '@/api/chat';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import type { ChatAttachmentPart } from '@bt/shared/types';
import { FileSpreadsheetIcon, FileTextIcon, ImageIcon, PaperclipIcon } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{ part: ChatAttachmentPart }>();

const imageUrl = ref<string | null>(null);
const isEnlarged = ref(false);

/** A part from before attachments carried their kind could be anything, so it is tried as an image. */
const isImageCandidate = computed(() => props.part.kind === undefined || props.part.kind === 'image');

const releaseImage = () => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = null;
};

onMounted(async () => {
  if (!isImageCandidate.value) return;

  try {
    const blob = await loadChatAttachmentImage({ attachmentId: props.part.attachmentId });
    if (blob.type && !blob.type.startsWith('image/')) return;
    imageUrl.value = URL.createObjectURL(blob);
  } catch {
    // A chip with the name stands in for an image that cannot be read.
  }
});

onBeforeUnmount(releaseImage);

const chipIcon = computed(() => {
  if (props.part.kind === 'csv') return FileSpreadsheetIcon;
  if (props.part.kind === 'pdf' || props.part.kind === 'text') return FileTextIcon;
  if (props.part.kind === 'image') return ImageIcon;
  return PaperclipIcon;
});
</script>

<template>
  <span class="inline-flex max-w-full min-w-0">
    <button
      v-if="imageUrl"
      type="button"
      class="focus-visible:ring-ring block overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
      data-testid="attachment-thumbnail"
      :aria-label="part.fileName ?? $t('chat.message.attachment')"
      @click="isEnlarged = true"
    >
      <img
        :src="imageUrl"
        :alt="part.fileName ?? $t('chat.message.attachment')"
        class="max-h-40 max-w-full object-cover"
      />
    </button>

    <span
      v-else
      class="bg-background/60 text-muted-foreground inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs"
      data-testid="attachment-chip"
    >
      <component :is="chipIcon" class="size-3 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ part.fileName ?? $t('chat.message.attachment') }}</span>
    </span>

    <ResponsiveDialog v-model:open="isEnlarged" dialog-content-class="sm:max-w-3xl">
      <template #title>{{ part.fileName ?? $t('chat.message.attachment') }}</template>
      <div v-if="imageUrl" class="flex max-h-[75dvh] items-center justify-center overflow-hidden">
        <img
          :src="imageUrl"
          :alt="part.fileName ?? $t('chat.message.attachment')"
          class="max-h-[75dvh] max-w-full object-contain"
        />
      </div>
    </ResponsiveDialog>
  </span>
</template>
