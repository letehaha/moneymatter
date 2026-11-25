<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-[425px]">
    <template #trigger>
      <slot />
    </template>

    <template #title>{{ $t('dialogs.deletePortfolio.title') }}</template>
    <template #description>
      {{ $t('dialogs.deletePortfolio.description') }}
    </template>

    <template #footer="{ close }">
      <UiButton variant="ghost" @click="close">{{ $t('dialogs.deletePortfolio.cancelButton') }}</UiButton>
      <UiButton variant="destructive" :disabled="deletePortfolioMutation.isPending.value" @click="handleDelete">
        <span v-if="deletePortfolioMutation.isPending.value">{{
          $t('dialogs.deletePortfolio.deleteButtonLoading')
        }}</span>
        <template v-else>
          <Trash2Icon class="size-4" />

          <span>
            {{ $t('dialogs.deletePortfolio.deleteButton') }}
          </span>
        </template>
      </UiButton>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useDeletePortfolio } from '@/composable/data-queries/portfolios';
import { ApiErrorResponseError } from '@/js/errors';
import { Trash2Icon } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  portfolioId: string;
}>();

const emit = defineEmits<{
  (e: 'deleted'): void;
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const deletePortfolioMutation = useDeletePortfolio();

const handleDelete = async () => {
  try {
    await deletePortfolioMutation.mutateAsync(props.portfolioId);
    addSuccessNotification(t('dialogs.deletePortfolio.notifications.success'));
    isOpen.value = false;
    emit('deleted');
  } catch (e) {
    const message =
      e instanceof ApiErrorResponseError && e.data?.message
        ? e.data.message
        : t('dialogs.deletePortfolio.notifications.error');
    addErrorNotification(message);
  }
};
</script>
