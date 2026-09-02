<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  title: string;
  icon?: Component;
}>();
</script>

<template>
  <div class="bg-card rounded-2xl border p-5 shadow-xs">
    <div class="mb-4 flex items-center gap-2">
      <component :is="icon" v-if="icon" class="text-muted-foreground size-4" />
      <h3 class="text-sm font-semibold tracking-tight">{{ title }}</h3>
    </div>
    <dl class="grid gap-3">
      <slot />
    </dl>
  </div>
</template>
