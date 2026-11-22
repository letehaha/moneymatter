<template>
  <ResponsiveAlertDialog
    v-model:open="isOpen"
    :cancel-label="$t('settings.currencies.dialog.discard.keep')"
    :confirm-label="$t('settings.currencies.dialog.discard.confirm')"
    confirm-variant="destructive"
    @confirm="handleDiscard"
  >
    <template #title>{{ $t('settings.currencies.dialog.discard.title') }}</template>
    <template #description>
      <template v-if="currentSourceText">
        {{ $t('settings.currencies.dialog.discard.body', { code, current: currentSourceText }) }}
      </template>
      <template v-else>{{ $t('settings.currencies.dialog.discard.rateBody', { code }) }}</template>
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';

defineProps<{
  code: string;
  /** The saved rate source a dropped source draft leaves in place; `null` for an unsaved rate. */
  currentSourceText: string | null;
}>();

const emit = defineEmits<{ discard: [] }>();

const isOpen = defineModel<boolean>('open', { required: true });

const handleDiscard = () => {
  isOpen.value = false;
  emit('discard');
};
</script>
