<template>
  <!-- ListboxItem caches its own attrs, so checked styling comes from data-state, never a dynamic class. -->
  <ListboxItem
    :value="value"
    :disabled="disabled"
    class="data-highlighted:bg-accent data-[state=checked]:data-highlighted:bg-accent flex cursor-pointer items-center rounded-md data-disabled:data-highlighted:bg-transparent"
    @mousedown.prevent
    @select="!disabled && emit('toggle')"
  >
    <slot />
  </ListboxItem>
</template>

<script setup lang="ts">
import { ListboxItem } from 'reka-ui';

defineProps<{ value: string; disabled?: boolean }>();

const emit = defineEmits<{ toggle: [] }>();
</script>
