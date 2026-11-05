<template>
  <!-- ListboxItem caches its own attrs, so checked styling comes from data-state, never a dynamic class. -->
  <ListboxItem
    :value="value"
    class="data-highlighted:bg-accent data-[state=checked]:data-highlighted:bg-accent flex cursor-pointer items-center rounded-md"
    @mousedown.prevent
    @select="emit('toggle')"
  >
    <slot />
  </ListboxItem>
</template>

<script setup lang="ts">
import { ListboxItem } from 'reka-ui';

defineProps<{ value: string }>();

const emit = defineEmits<{ toggle: [] }>();
</script>
