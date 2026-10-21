<script setup lang="ts">
import Card from '@/components/lib/ui/card/Card.vue';
</script>

<template>
  <div class="max-w-5xl" aria-busy="true">
    <Card class="divide-border @container/goal divide-y overflow-hidden">
      <div class="flex items-center gap-3 px-3 py-3 @md/goal:px-4">
        <div class="bg-muted size-9 shrink-0 animate-pulse rounded-lg" />
        <div class="grid gap-1.5">
          <div class="bg-muted h-5 w-40 animate-pulse rounded" />
          <div class="bg-muted h-3 w-56 animate-pulse rounded" />
        </div>
        <div class="bg-muted ml-auto h-8 w-20 animate-pulse rounded" />
      </div>
      <div class="flex gap-1.5 px-3 py-2 @md/goal:px-4">
        <div v-for="i in 3" :key="i" class="bg-muted h-5 w-28 animate-pulse rounded-full" />
      </div>
      <div class="grid grid-cols-2 @md/goal:grid-cols-3 @2xl/goal:grid-cols-5">
        <div v-for="i in 5" :key="i" class="px-3 py-3 @md/goal:px-4">
          <div class="bg-muted h-3 w-12 animate-pulse rounded" />
          <div class="bg-muted mt-2 h-5 w-20 animate-pulse rounded" />
        </div>
      </div>
      <div class="px-3 py-2 @md/goal:px-4">
        <div class="bg-muted h-8 w-64 animate-pulse rounded-lg" />
      </div>
      <div class="p-4">
        <div class="bg-muted h-64 animate-pulse rounded" />
      </div>
    </Card>
  </div>
</template>
