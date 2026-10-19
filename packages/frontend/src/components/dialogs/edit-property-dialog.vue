<script setup lang="ts">
import type { PropertyModel } from '@/api/properties';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import EditPropertyForm from '@/components/forms/edit-property-form.vue';
import { isMobileSheetOpen } from '@/composable/global-state/mobile-sheet';

defineProps<{ property: PropertyModel }>();
const open = defineModel<boolean>('open', { default: false });

const onUpdated = () => {
  open.value = false;
  isMobileSheetOpen.value = false;
};
</script>

<template>
  <ResponsiveDialog v-model:open="open">
    <template #title>{{ $t('common.dialogs.editProperty') }}</template>
    <EditPropertyForm :property="property" @updated="onUpdated" />
  </ResponsiveDialog>
</template>
