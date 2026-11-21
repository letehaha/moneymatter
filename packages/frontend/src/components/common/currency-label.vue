<script setup lang="ts">
import CurrencyIcon from '@/components/common/currency-icon.vue';

defineProps<{ code: string }>();
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <CurrencyIcon :code="code" size="size-5" />
    <span class="font-bold">{{ code }}</span>
  </span>
</template>
