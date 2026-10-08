<script lang="ts" setup>
import { deleteAttachment, loadTransactionAttachments, uploadTransactionAttachment } from '@/api/attachments';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { compressImages } from '@/common/utils/compress-image';
import { formatBytes } from '@/common/utils/format-bytes';
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import { MultiFileDropzone } from '@/components/common/dropzone';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { cn } from '@/lib/utils';
import { useUserStore } from '@/stores';
import {
  ATTACHMENTS_MAX_PER_TRANSACTION,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MIME_TYPES,
  FEATURES,
  type TransactionAttachmentModel,
} from '@bt/shared/types';
import {
  ChevronRightIcon,
  FileTextIcon,
  ImageIcon,
  LoaderCircleIcon,
  LockIcon,
  PaperclipIcon,
  Trash2Icon,
} from '@lucide/vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import AttachmentViewerDialog from './attachment-viewer-dialog.vue';
import FormRow from './form-row.vue';

/** Without `transactionId` the section only collects files; the caller uploads them once the row exists. */
const props = defineProps<{
  transactionId?: string;
  /** The other transfer leg: uploads land on both, deletes stay per-leg. */
  mirrorTransactionId?: string;
  disabled?: boolean;
}>();

const pending = defineModel<File[]>('pending', { default: () => [] });

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const userStore = useUserStore();
const queryClient = useQueryClient();

const ACCEPT_ATTRIBUTE = ATTACHMENT_MIME_TYPES.join(',');
const MAX_FILE_SIZE_LABEL = formatBytes({ bytes: ATTACHMENT_MAX_FILE_BYTES, fractionDigits: 0 });

const isDialogOpen = ref(false);
const uploadingNames = ref<string[]>([]);
const viewedAttachment = ref<TransactionAttachmentModel | null>(null);
const isViewerOpen = ref(false);
const pendingDeletion = ref<TransactionAttachmentModel[]>([]);

const canManage = computed(() => !userStore.isFeatureGated(FEATURES.attachments));

const isPersisted = computed(() => Boolean(props.transactionId));
const queryKey = computed(() => [...VUE_QUERY_CACHE_KEYS.transactionAttachments, props.transactionId]);

const { data, isLoading, isError } = useQuery({
  queryKey,
  queryFn: () => loadTransactionAttachments({ transactionId: props.transactionId! }),
  enabled: isPersisted,
});

const attachments = computed<TransactionAttachmentModel[]>(() => data.value ?? []);

type Item = {
  key: string;
  filename: string;
  size: number;
  mimeType: string;
  stored?: TransactionAttachmentModel;
  file?: File;
};
const items = computed<Item[]>(() =>
  isPersisted.value
    ? attachments.value.map((stored) => ({ key: stored.id, ...stored, stored }))
    : pending.value.map((file, index) => ({
        key: `${index}-${file.name}`,
        filename: file.name,
        size: file.size,
        mimeType: file.type,
        file,
      })),
);

const invalidateKeys = [VUE_QUERY_CACHE_KEYS.transactionAttachments, [VUE_QUERY_GLOBAL_PREFIXES.transactionChange]];

// `mutateAsync` resolves only after every invalidated query refetched, so the uploading row
// is swapped for the stored one here; waiting would show the same file in both states.
const uploadAndShow = async (variables: { transactionId: string; file: File }) => {
  const created = await uploadTransactionAttachment(variables);
  queryClient.setQueryData<TransactionAttachmentModel[]>(queryKey.value, (current = []) => [...current, created]);
  if (props.mirrorTransactionId) {
    await uploadTransactionAttachment({ transactionId: props.mirrorTransactionId, file: variables.file });
  }
  uploadingNames.value = uploadingNames.value.slice(1);
  return created;
};

const uploadMutation = useInvalidatingMutation({
  mutationFn: uploadAndShow,
  invalidateKeys,
  errorKey: 'dialogs.manageTransaction.form.attachments.errors.upload',
});

const deleteMutation = useInvalidatingMutation({
  mutationFn: ({ ids }: { ids: string[] }) => Promise.all(ids.map((id) => deleteAttachment({ id }))),
  invalidateKeys,
  errorKey: 'dialogs.manageTransaction.form.attachments.errors.delete',
});

const isAddDisabled = computed(
  () =>
    props.disabled ||
    isError.value ||
    uploadingNames.value.length > 0 ||
    items.value.length >= ATTACHMENTS_MAX_PER_TRANSACTION,
);

const showDeleteAll = computed(() => canManage.value && items.value.length > 1);

const totalSize = computed(() => items.value.reduce((sum, item) => sum + item.size, 0));

const triggerLabel = computed(() => {
  if (uploadingNames.value.length) return t('dialogs.manageTransaction.form.attachments.trigger.uploading');
  if (isLoading.value) return t('dialogs.manageTransaction.form.attachments.loading');
  if (items.value.length === 1) return items.value[0]!.filename;
  if (items.value.length) {
    return t(
      'dialogs.manageTransaction.form.attachments.trigger.count',
      { count: items.value.length },
      items.value.length,
    );
  }
  return t('dialogs.manageTransaction.form.attachments.trigger.empty');
});

const openViewer = (attachment: TransactionAttachmentModel) => {
  viewedAttachment.value = attachment;
  isViewerOpen.value = true;
};

const uploadFiles = async (selected: File[]) => {
  if (!selected.length) return;

  const accepted = selected.filter((file) => (ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type));
  if (accepted.length < selected.length) {
    addErrorNotification(t('dialogs.manageTransaction.form.attachments.errors.unsupportedType'));
  }
  if (!accepted.length) return;

  if (items.value.length + accepted.length > ATTACHMENTS_MAX_PER_TRANSACTION) {
    addErrorNotification(
      t('dialogs.manageTransaction.form.attachments.errors.tooMany', { max: ATTACHMENTS_MAX_PER_TRANSACTION }),
    );
    return;
  }

  uploadingNames.value = accepted.map((file) => file.name);

  try {
    // A failed compression still uploads the originals.
    const prepared = await compressImages({ files: accepted }).catch(() => accepted);

    for (const file of prepared) {
      if (file.size > ATTACHMENT_MAX_FILE_BYTES) {
        addErrorNotification(
          t('dialogs.manageTransaction.form.attachments.errors.tooLarge', {
            filename: file.name,
            max: MAX_FILE_SIZE_LABEL,
          }),
        );
        uploadingNames.value = uploadingNames.value.slice(1);
      } else if (!props.transactionId) {
        pending.value = [...pending.value, file];
        uploadingNames.value = uploadingNames.value.slice(1);
      } else {
        try {
          await uploadMutation.mutateAsync({ transactionId: props.transactionId, file });
        } catch {
          // The mutation already surfaced the server message.
          uploadingNames.value = uploadingNames.value.slice(1);
        }
      }
    }
  } finally {
    uploadingNames.value = [];
  }
};

const removeItem = ({ item }: { item: Item }) => {
  if (item.stored) pendingDeletion.value = [item.stored];
  else pending.value = pending.value.filter((file) => file !== item.file);
};

const removeAll = () => {
  if (isPersisted.value) pendingDeletion.value = attachments.value;
  else pending.value = [];
};

const confirmDeletion = async () => {
  const ids = pendingDeletion.value.map((attachment) => attachment.id);
  pendingDeletion.value = [];
  if (!ids.length) return;

  try {
    await deleteMutation.mutateAsync({ ids });
  } catch {
    // The mutation already surfaced the server message. A partly failed bulk delete
    // still removed some files, so the list is refetched.
    queryClient.invalidateQueries({ queryKey: queryKey.value });
  }
};
</script>

<template>
  <FormRow>
    <FieldLabel :label="$t('dialogs.manageTransaction.form.attachments.label')" only-template>
      <DemoRestricted feature="attach_file" content-class="block w-full">
        <Button
          type="button"
          variant="outline"
          class="border-input bg-input-background h-auto min-h-10 w-full justify-start px-3 font-normal md:min-h-9"
          :disabled="userStore.isDemo"
          @click="isDialogOpen = true"
        >
          <LoaderCircleIcon v-if="uploadingNames.length" class="text-primary-text size-4 shrink-0 animate-spin" />
          <PaperclipIcon
            v-else
            :class="cn('size-4 shrink-0', items.length ? 'text-primary-text' : 'text-muted-foreground')"
          />
          <span :class="cn('min-w-0 flex-1 truncate text-left', !items.length && 'text-muted-foreground')">
            {{ triggerLabel }}
          </span>
          <span v-if="items.length" class="text-muted-foreground shrink-0 text-xs">
            {{ formatBytes({ bytes: totalSize }) }}
          </span>
          <component
            :is="userStore.isDemo ? LockIcon : ChevronRightIcon"
            class="text-muted-foreground size-4 shrink-0"
          />
        </Button>
      </DemoRestricted>
    </FieldLabel>
  </FormRow>

  <ResponsiveDialog v-model:open="isDialogOpen" dialog-content-class="sm:max-w-lg" :hide-drawer-footer="!showDeleteAll">
    <template #title>
      {{ $t('dialogs.manageTransaction.form.attachments.label') }}
      <span class="text-muted-foreground ml-1 text-sm font-normal">
        {{ items.length }} / {{ ATTACHMENTS_MAX_PER_TRANSACTION }}
      </span>
    </template>

    <div class="grid gap-4">
      <PlanRestricted :feature="FEATURES.attachments">
        <MultiFileDropzone
          :model-value="[]"
          :accept="ACCEPT_ATTRIBUTE"
          :disabled="isAddDisabled"
          height="min-h-[140px]"
          :idle-text="$t('dialogs.manageTransaction.form.attachments.dropzone.idle')"
          :drag-text="$t('dialogs.manageTransaction.form.attachments.dropzone.drag')"
          @update:model-value="uploadFiles"
        >
          <template #hint>
            {{
              $t('dialogs.manageTransaction.form.attachments.hint', {
                max: ATTACHMENTS_MAX_PER_TRANSACTION,
                size: MAX_FILE_SIZE_LABEL,
              })
            }}
          </template>
        </MultiFileDropzone>
      </PlanRestricted>

      <p v-if="isError" class="text-destructive-text text-sm">
        {{ $t('dialogs.manageTransaction.form.attachments.listLoadFailed') }}
      </p>

      <div v-if="items.length || uploadingNames.length" class="grid gap-1">
        <div v-for="item in items" :key="item.key" class="flex items-center gap-3 py-1">
          <div class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
            <component :is="item.mimeType === 'application/pdf' ? FileTextIcon : ImageIcon" class="size-4" />
          </div>

          <div class="grid min-w-0 flex-1">
            <Button
              v-if="item.stored"
              type="button"
              variant="link"
              class="h-auto justify-start p-0 text-sm font-medium"
              @click="openViewer(item.stored)"
            >
              <span class="truncate">{{ item.filename }}</span>
            </Button>
            <span v-else class="truncate text-sm font-medium">{{ item.filename }}</span>
            <span class="text-muted-foreground text-xs">{{ formatBytes({ bytes: item.size }) }}</span>
          </div>

          <DesktopOnlyTooltip v-if="canManage" :content="$t('common.actions.delete')">
            <Button
              type="button"
              variant="ghost-destructive"
              size="icon"
              :disabled="disabled"
              :aria-label="$t('common.actions.delete')"
              @click="removeItem({ item })"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>

        <div v-for="name in uploadingNames" :key="name" class="text-muted-foreground flex items-center gap-3 py-1">
          <div class="border-input flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed">
            <LoaderCircleIcon class="text-primary-text size-4 animate-spin" />
          </div>
          <span class="min-w-0 flex-1 truncate text-sm">{{ name }}</span>
        </div>
      </div>
    </div>

    <!-- Nested inside the dialog so it stacks above it. -->
    <ResponsiveAlertDialog
      :open="pendingDeletion.length > 0"
      :confirm-label="$t('common.actions.delete')"
      confirm-variant="destructive"
      @update:open="(value: boolean) => !value && (pendingDeletion = [])"
      @confirm="confirmDeletion"
    >
      <template v-if="pendingDeletion.length > 1" #title>
        {{ $t('dialogs.manageTransaction.form.attachments.deleteAllConfirm.title') }}
      </template>
      <template v-else #title>{{ $t('dialogs.manageTransaction.form.attachments.deleteConfirm.title') }}</template>
      <template #description>
        {{
          pendingDeletion.length > 1
            ? $t('dialogs.manageTransaction.form.attachments.deleteAllConfirm.description', {
                count: pendingDeletion.length,
              })
            : $t('dialogs.manageTransaction.form.attachments.deleteConfirm.description', {
                filename: pendingDeletion[0]?.filename,
              })
        }}
      </template>
    </ResponsiveAlertDialog>

    <template #footer="{ close }">
      <Button
        v-if="showDeleteAll"
        type="button"
        variant="ghost-destructive"
        class="sm:mr-auto"
        :disabled="disabled"
        @click="removeAll"
      >
        <Trash2Icon class="size-4" />
        {{ $t('dialogs.manageTransaction.form.attachments.deleteAll') }}
      </Button>
      <Button type="button" variant="secondary" @click="close">{{ $t('common.actions.done') }}</Button>
    </template>
  </ResponsiveDialog>

  <AttachmentViewerDialog v-model:open="isViewerOpen" :attachment="viewedAttachment" />
</template>
