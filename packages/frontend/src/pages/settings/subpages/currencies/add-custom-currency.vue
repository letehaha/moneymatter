<template>
  <Button type="button" size="sm" variant="outline" data-testid="add-custom-currency" @click="isOpen = true">
    <PlusIcon class="size-4" />
    {{ $t('settings.currencies.custom.addButton') }}
  </Button>

  <CustomCurrencyDialog v-model:open="isOpen" />
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { PlusIcon } from '@lucide/vue';
import { ref } from 'vue';

import CustomCurrencyDialog from './custom-currency-dialog.vue';

const isOpen = ref(false);
</script>
