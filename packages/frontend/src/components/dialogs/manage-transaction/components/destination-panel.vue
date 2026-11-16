<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <div class="border-border bg-muted/30 fields-plain rounded-xl border p-3 [&>:last-child]:mb-0">
    <p class="text-muted-foreground mb-3 px-1 text-xs font-medium tracking-wider uppercase">{{ label }}</p>
    <slot />
  </div>
</template>
