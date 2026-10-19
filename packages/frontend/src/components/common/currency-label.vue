<script setup lang="ts">
import { getCurrencyIcon } from '@/js/helpers/currencyImage';
import { CoinsIcon } from '@lucide/vue';
import { ref, watch } from 'vue';

const props = defineProps<{ code: string }>();

const flagFailed = ref(false);
watch(
  () => props.code,
  () => {
    flagFailed.value = false;
  },
);
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <img
      v-if="!flagFailed"
      :src="getCurrencyIcon(code)"
      :alt="code"
      class="size-5 shrink-0 rounded-full"
      loading="lazy"
      @error="flagFailed = true"
    />
    <CoinsIcon v-else class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
    <span class="font-bold">{{ code }}</span>
  </span>
</template>
