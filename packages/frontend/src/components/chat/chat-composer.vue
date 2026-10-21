<script setup lang="ts">
import { uploadChatAttachment } from '@/api/chat';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { extractApiErrorMessage } from '@/js/errors';
import { fitImageForUpload } from '@/pages/import-export/statement-parser/utils/fit-image-for-upload';
import { cn } from '@/lib/utils';
import type { ChatAttachment } from '@bt/shared/types';
import { FileTextIcon, Loader2Icon, PaperclipIcon, SendIcon, SquareIcon, XIcon } from '@lucide/vue';
import { useMediaQuery } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  CHAT_ATTACHMENT_ACCEPT,
  type ChatAttachmentProblem,
  isImageFile,
  planChatAttachments,
} from './chat-attachments';

const props = withDefaults(
  defineProps<{
    /** An answer is streaming: sending waits, stopping is offered. */
    isStreaming: boolean;
    /** Chat has no model to run on, or cannot take a message for another reason. */
    disabled?: boolean;
    /** The thread to put attachments on; a conversation that has not started creates it here. */
    ensureThread: () => Promise<string>;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  send: [message: { text: string; attachmentIds: string[] }];
  cancel: [];
}>();

// "Enter to send, Shift+Enter for a new line" does not apply on a touchscreen without a hardware keyboard.
const isTouchOnly = useMediaQuery('(hover: none) and (pointer: coarse)');
const showKeyboardHint = computed(() => !isTouchOnly.value);

interface PendingAttachment {
  localId: number;
  file: File;
  status: 'uploading' | 'ready' | 'needsPassword';
  attachment: ChatAttachment | null;
  password: string;
}

const { t } = useI18n();

const text = ref('');
const attachments = ref<PendingAttachment[]>([]);
const problems = ref<ChatAttachmentProblem[]>([]);
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const textareaRef = ref<{ $el: HTMLElement } | null>(null);
let nextLocalId = 0;

const isUploading = computed(() => attachments.value.some((item) => item.status !== 'ready'));
const readyIds = computed(() =>
  attachments.value.flatMap((item) => (item.status === 'ready' && item.attachment ? [item.attachment.id] : [])),
);
const canSend = computed(
  () =>
    !props.disabled &&
    !props.isStreaming &&
    !isUploading.value &&
    (text.value.trim() !== '' || readyIds.value.length > 0),
);

const update = ({ localId, patch }: { localId: number; patch: Partial<PendingAttachment> }) => {
  attachments.value = attachments.value.map((item) => (item.localId === localId ? { ...item, ...patch } : item));
};

const drop = ({ localId }: { localId: number }) => {
  attachments.value = attachments.value.filter((item) => item.localId !== localId);
};

const reportProblem = (problem: ChatAttachmentProblem) => {
  problems.value = [...problems.value, problem];
};

const upload = async ({ item, threadId }: { item: PendingAttachment; threadId: string }) => {
  update({ localId: item.localId, patch: { status: 'uploading' } });
  try {
    const attachment = await uploadChatAttachment({
      threadId,
      file: item.file,
      password: item.password || undefined,
    });
    update({ localId: item.localId, patch: { status: 'ready', attachment } });
  } catch (error) {
    // The server words this one: a PDF that needs a password is answered with a message that says so.
    const needsPassword =
      item.file.name.toLowerCase().endsWith('.pdf') && /password/i.test(extractApiErrorMessage(error) ?? '');
    if (needsPassword) {
      update({ localId: item.localId, patch: { status: 'needsPassword' } });
      return;
    }
    drop({ localId: item.localId });
    const reason = extractApiErrorMessage(error);
    reportProblem(
      reason
        ? { key: 'chat.composer.attachments.uploadRefused', params: { name: item.file.name, reason } }
        : { key: 'chat.composer.attachments.uploadFailed', params: { name: item.file.name } },
    );
  }
};

/**
 * Shrinks images and turns HEIC/HEIF into JPEG before upload. The browser decodes them because the
 * server never does; Safari can read HEIC, other engines cannot and the file is reported as unreadable.
 */
const prepareFiles = async ({ files }: { files: File[] }) => {
  const prepared: File[] = [];
  const unreadable: ChatAttachmentProblem[] = [];
  for (const file of files) {
    if (!isImageFile({ file })) {
      prepared.push(file);
      continue;
    }
    try {
      prepared.push(await fitImageForUpload({ file }));
    } catch {
      unreadable.push({ key: 'chat.composer.attachments.unreadableImage', params: { name: file.name } });
    }
  }
  return { prepared, unreadable };
};

const addFiles = async ({ files }: { files: File[] }) => {
  const { prepared, unreadable } = await prepareFiles({ files });
  const plan = planChatAttachments({
    current: attachments.value.map((item) => ({ sizeBytes: item.file.size })),
    incoming: prepared,
  });
  problems.value = [...unreadable, ...plan.problems];
  if (plan.accepted.length === 0) return;

  const added = plan.accepted.map(
    (file): PendingAttachment => ({
      localId: nextLocalId++,
      file,
      status: 'uploading',
      attachment: null,
      password: '',
    }),
  );
  attachments.value = [...attachments.value, ...added];

  let threadId: string;
  try {
    threadId = await props.ensureThread();
  } catch {
    for (const item of added) {
      drop({ localId: item.localId });
      reportProblem({ key: 'chat.composer.attachments.uploadFailed', params: { name: item.file.name } });
    }
    return;
  }
  await Promise.all(added.map((item) => upload({ item, threadId })));
};

const unlock = async ({ item }: { item: PendingAttachment }) => {
  const threadId = await props.ensureThread();
  await upload({ item, threadId });
};

const onFilesPicked = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  // Picking the same file again must fire `change` again.
  if (input.value) input.value = '';
  if (files.length > 0) void addFiles({ files });
};

const hasFiles = ({ event }: { event: DragEvent }) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

const onDragOver = (event: DragEvent) => {
  if (props.disabled || !hasFiles({ event })) return;
  event.preventDefault();
  isDragging.value = true;
};

const onDrop = (event: DragEvent) => {
  isDragging.value = false;
  if (props.disabled) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) void addFiles({ files });
};

const onPaste = (event: ClipboardEvent) => {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (props.disabled || files.length === 0) return;
  event.preventDefault();
  void addFiles({ files });
};

const submit = () => {
  if (!canSend.value) return;

  emit('send', {
    text: text.value.trim(),
    attachmentIds: readyIds.value,
  });
  text.value = '';
  attachments.value = [];
  problems.value = [];
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
};

defineExpose({
  /** Puts text in the box and focuses it, for an example prompt the user can still edit. */
  fill: ({ text: value }: { text: string }) => {
    text.value = value;
    textareaRef.value?.$el.querySelector('textarea')?.focus();
  },
});
</script>

<template>
  <div
    :class="cn('relative flex flex-col gap-2 border-t p-3', isDragging && 'bg-primary/5')"
    data-testid="chat-composer"
    @dragover="onDragOver"
    @dragleave="isDragging = false"
    @drop.prevent="onDrop"
    @paste="onPaste"
    @keydown="onKeydown"
  >
    <div
      v-if="isDragging"
      class="border-primary text-primary-text bg-background/80 pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium"
    >
      {{ $t('chat.composer.dropToAttach') }}
    </div>

    <ul v-if="attachments.length > 0" class="flex flex-col gap-1.5">
      <li
        v-for="item in attachments"
        :key="item.localId"
        class="bg-muted/50 flex min-w-0 flex-col gap-1.5 rounded-md px-2 py-1.5 text-xs"
        data-testid="attachment"
      >
        <div class="flex min-w-0 items-center gap-2">
          <Loader2Icon
            v-if="item.status === 'uploading'"
            class="text-muted-foreground size-4 shrink-0 animate-spin"
            role="status"
            :aria-label="$t('chat.composer.attachments.uploading', { name: item.file.name })"
          />
          <FileTextIcon v-else class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ item.file.name }}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="ml-auto size-5 shrink-0"
            data-testid="attachment-remove"
            :aria-label="$t('chat.composer.removeAttachment', { name: item.file.name })"
            @click="drop({ localId: item.localId })"
          >
            <XIcon class="size-3" aria-hidden="true" />
          </Button>
        </div>
        <div v-if="item.status === 'needsPassword'" class="flex items-center gap-2">
          <InputField
            v-model="item.password"
            type="password"
            class="flex-1"
            data-testid="attachment-password"
            :placeholder="$t('chat.composer.attachments.passwordPlaceholder')"
          />
          <Button type="button" size="sm" data-testid="attachment-unlock" @click="unlock({ item })">
            {{ $t('chat.composer.attachments.unlock') }}
          </Button>
        </div>
      </li>
    </ul>

    <p
      v-for="problem in problems"
      :key="problem.key + JSON.stringify(problem.params)"
      class="text-destructive-text text-xs"
      role="alert"
      data-testid="attachment-problem"
    >
      {{ $t(problem.key, problem.params) }}
    </p>

    <!-- One 44px line when empty: the buttons and the textarea share a height, and stay at the bottom as it grows.
         The field forwards its class to both its root and its textarea, so the padding targets the textarea only. -->
    <div class="flex items-end gap-2">
      <DesktopOnlyTooltip :content="$t('chat.composer.attach')">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-11 shrink-0"
          data-testid="attach"
          :disabled="disabled"
          :aria-label="$t('chat.composer.attach')"
          @click="fileInputRef?.click()"
        >
          <PaperclipIcon class="size-4" aria-hidden="true" />
        </Button>
      </DesktopOnlyTooltip>
      <input
        ref="fileInputRef"
        type="file"
        multiple
        class="hidden"
        data-testid="file-input"
        :accept="CHAT_ATTACHMENT_ACCEPT"
        :disabled="disabled"
        @change="onFilesPicked"
      />

      <!-- The field wraps its textarea in an inline label, which would add a line gap under it. -->
      <div class="min-w-0 flex-1 [&_.field-label]:block [&_textarea]:block">
        <TextareaField
          ref="textareaRef"
          v-model="text"
          rows="1"
          class="min-h-11 leading-5 placeholder:whitespace-nowrap [&_textarea]:py-[11px]"
          :title="$t('chat.composer.label')"
          :placeholder="$t('chat.composer.placeholder')"
          :disabled="disabled"
        />
      </div>

      <Button
        v-if="isStreaming"
        type="button"
        variant="outline"
        size="icon"
        class="size-11 shrink-0"
        data-testid="stop"
        :aria-label="$t('chat.composer.stop')"
        @click="emit('cancel')"
      >
        <SquareIcon class="size-4" aria-hidden="true" />
      </Button>
      <Button
        v-else
        type="button"
        size="icon"
        class="size-11 shrink-0"
        data-testid="send"
        :disabled="!canSend"
        :aria-label="$t('chat.composer.send')"
        @click="submit"
      >
        <SendIcon class="size-4" aria-hidden="true" />
      </Button>
    </div>
    <p v-if="showKeyboardHint" class="text-muted-foreground hidden px-1 text-xs @sm/chat-conversation:block">
      {{ $t('chat.composer.hint') }}
    </p>
  </div>
</template>
