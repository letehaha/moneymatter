<script setup lang="ts">
import * as transactionGroupsApi from '@/api/transaction-groups';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { invalidateTransactionGroupQueries } from '@/composable/data-queries/transaction-groups';
import { TRANSACTION_GROUP_MAX_SIZE, TRANSACTION_GROUP_MIN_SIZE } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { getGroupErrorMessage } from './group-error-message';

const { t } = useI18n();

const props = defineProps<{
  open?: boolean;
  transactionIds: string[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  created: [];
}>();

const queryClient = useQueryClient();

const form = reactive({
  name: '',
  note: '',
});

const isSubmitting = ref(false);
const error = ref('');

watch(
  () => props.open,
  (val) => {
    if (val) {
      form.name = '';
      form.note = '';
      error.value = '';
    }
  },
);

const handleSubmit = async () => {
  if (!form.name.trim()) {
    error.value = t('transactions.transactionGroups.errors.nameRequired');
    return;
  }
  if (props.transactionIds.length < TRANSACTION_GROUP_MIN_SIZE) {
    error.value = t('transactions.transactionGroups.errors.minTransactions', { min: TRANSACTION_GROUP_MIN_SIZE });
    return;
  }
  if (props.transactionIds.length > TRANSACTION_GROUP_MAX_SIZE) {
    error.value = t('transactions.transactionGroups.errors.tooManyTransactions', {
      max: TRANSACTION_GROUP_MAX_SIZE,
      count: props.transactionIds.length,
    });
    return;
  }

  isSubmitting.value = true;
  error.value = '';

  try {
    await transactionGroupsApi.createTransactionGroup({
      name: form.name.trim(),
      note: form.note.trim() || null,
      transactionIds: props.transactionIds,
    });

    invalidateTransactionGroupQueries({ queryClient });

    emit('update:open', false);
    emit('created');
  } catch (e) {
    error.value = getGroupErrorMessage({ e, t, fallbackKey: 'transactions.transactionGroups.errors.createFailed' });
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <ResponsiveDialog :open="open" dialog-content-class="sm:max-w-md" @update:open="emit('update:open', $event)">
    <template #title>{{ t('transactions.transactionGroups.createGroupDialog.title') }}</template>
    <template #description>
      {{ t('transactions.transactionGroups.createGroupDialog.descriptionPrefix') }} {{ transactionIds.length }} selected
      transactions
    </template>

    <form class="space-y-4 py-2" @submit.prevent="handleSubmit">
      <InputField
        v-model="form.name"
        :label="t('transactions.transactionGroups.createGroupDialog.groupNameLabel')"
        :placeholder="t('transactions.transactionGroups.createGroupDialog.groupNamePlaceholder')"
        :autofocus="true"
      />
      <TextareaField
        v-model="form.note"
        :label="t('transactions.transactionGroups.createGroupDialog.noteLabel')"
        :rows="2"
        :placeholder="t('transactions.transactionGroups.createGroupDialog.notePlaceholder')"
      />

      <p v-if="error" class="text-destructive-text text-sm">{{ error }}</p>

      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" @click="emit('update:open', false)">{{
          t('transactions.transactionGroups.createGroupDialog.cancelButton')
        }}</Button>
        <Button type="submit" :disabled="isSubmitting || !form.name.trim()">
          {{
            isSubmitting
              ? t('transactions.transactionGroups.createGroupDialog.creatingText')
              : t('transactions.transactionGroups.createGroupDialog.buttonLabel')
          }}
        </Button>
      </div>
    </form>
  </ResponsiveDialog>
</template>
