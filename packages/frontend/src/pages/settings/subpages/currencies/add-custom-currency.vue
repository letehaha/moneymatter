<template>
  <Button type="button" size="sm" variant="outline" data-testid="add-custom-currency" @click="isOpen = true">
    <PlusIcon class="size-4" />
    {{ $t('settings.currencies.custom.addButton') }}
  </Button>

  <ResponsiveDialog v-if="isGated" v-model:open="isOpen" dialog-content-class="max-w-md">
    <template #title>{{ $t('settings.currencies.custom.createTitle') }}</template>
    <PlanRestricted :feature="FEATURES.custom_currencies" />
  </ResponsiveDialog>
  <CustomCurrencyDialog v-else v-model:open="isOpen" />
</template>

<script setup lang="ts">
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useUserStore } from '@/stores';
import { FEATURES } from '@bt/shared/types';
import { PlusIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import CustomCurrencyDialog from './custom-currency-dialog.vue';

const userStore = useUserStore();
const isGated = computed(() => userStore.isFeatureGated(FEATURES.custom_currencies));
const isOpen = ref(false);
</script>
