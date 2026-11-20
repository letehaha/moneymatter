<script setup lang="ts">
import * as transactionGroupsApi from '@/api/transaction-groups';
import type { TransactionGroupResponse } from '@/api/transaction-groups';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage } from '@/js/errors';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  open?: boolean;
  group: TransactionGroupResponse | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  saved: [];
}>();

const { addErrorNotification } = useNotificationCenter();

const form = reactive({ name: '', note: '' as string | undefined });

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && props.group) {
      form.name = props.group.name;
      form.note = props.group.note ?? '';
    }
  },
);

const isSaving = ref(false);

const save = async () => {
  if (!props.group || !form.name.trim()) return;
  isSaving.value = true;
  try {
    await transactionGroupsApi.updateTransactionGroup({
      id: props.group.id,
      payload: {
        name: form.name.trim(),
        note: form.note?.trim() || null,
      },
    });
    emit('update:open', false);
    emit('saved');
  } catch (error) {
    addErrorNotification(extractApiErrorMessage(error) || t('transactionGroups.groupDialog.saveError'));
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <ResponsiveDialog :open="open" @update:open="emit('update:open', $event)">
    <template #title>{{ t('transactionGroups.groupDialog.editTitle') }}</template>
    <template #description />

    <div class="space-y-3 py-2">
      <InputField v-model="form.name" :label="t('transactionGroups.groupDialog.nameLabel')" />
      <TextareaField
        v-model="form.note"
        :label="t('transactionGroups.groupDialog.noteLabel')"
        :rows="2"
        :placeholder="t('transactionGroups.groupDialog.notePlaceholder')"
      />
      <div class="flex justify-end gap-2">
        <Button variant="ghost" @click="emit('update:open', false)">
          {{ t('transactionGroups.groupDialog.cancelButton') }}
        </Button>
        <Button :disabled="!form.name.trim() || isSaving" @click="save">
          {{ t('transactionGroups.groupDialog.savingAction') }}
        </Button>
      </div>
    </div>
  </ResponsiveDialog>
</template>
