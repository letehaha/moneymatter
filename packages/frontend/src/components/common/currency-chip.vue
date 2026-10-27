<script setup lang="ts">
defineProps<{ code: string }>();
</script>

<template>
  <span
    class="border-border text-muted-foreground shrink-0 rounded-[5px] border px-1.5 py-px text-[10.5px] font-bold tracking-wider tabular-nums"
  >
    {{ code }}
  </span>
</template>
