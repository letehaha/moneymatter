<script setup lang="ts">
const SKELETON_ROWS = 5;
</script>

<template>
  <div class="@container/skeleton grid gap-6">
    <div class="grid grid-cols-2 gap-3 @2xl/skeleton:grid-cols-4">
      <div v-for="tile in 4" :key="tile" class="bg-muted h-20 animate-pulse rounded-lg" />
    </div>
    <div class="border-border hidden gap-px overflow-hidden rounded-lg border @2xl/skeleton:grid">
      <div v-for="row in SKELETON_ROWS" :key="row" class="bg-muted h-14 animate-pulse" />
    </div>
    <div class="grid gap-2 @2xl/skeleton:hidden">
      <div v-for="row in SKELETON_ROWS" :key="row" class="bg-muted h-30 animate-pulse rounded-lg" />
    </div>
  </div>
</template>
