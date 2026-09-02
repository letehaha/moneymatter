<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div class="flex items-baseline justify-between gap-4 text-sm">
    <dt class="text-muted-foreground">{{ label }}</dt>
    <dd class="text-foreground text-right">
      <slot />
    </dd>
  </div>
</template>
