<script setup lang="ts">
import Card from '@/components/lib/ui/card/Card.vue';
</script>

<template>
  <div class="max-w-5xl" aria-busy="true">
    <Card class="divide-border @container/tracker divide-y overflow-hidden">
      <div class="flex items-center gap-3 px-3 py-3 @md/tracker:px-4">
        <div class="bg-muted size-9 shrink-0 animate-pulse rounded-lg" />
        <div class="grid gap-1.5">
          <div class="bg-muted h-5 w-40 animate-pulse rounded" />
          <div class="bg-muted h-3 w-56 animate-pulse rounded" />
        </div>
        <div class="bg-muted ml-auto h-8 w-20 animate-pulse rounded" />
      </div>

      <div class="grid grid-cols-1 @md/tracker:grid-cols-3 @2xl/tracker:grid-cols-5">
        <div v-for="i in 5" :key="i" class="px-3 py-3 @md/tracker:px-4">
          <div class="bg-muted h-3 w-12 animate-pulse rounded" />
          <div class="bg-muted mt-2 h-5 w-20 animate-pulse rounded" />
        </div>
      </div>

      <div class="px-3 py-2 @md/tracker:px-4">
        <div class="bg-muted h-8 w-64 animate-pulse rounded-lg" />
      </div>

      <div v-for="i in 4" :key="i" class="flex items-center gap-3 px-3 py-3 @md/tracker:px-4">
        <div class="bg-muted size-7 animate-pulse rounded-full" />
        <div class="bg-muted h-4 flex-1 animate-pulse rounded" />
        <div class="bg-muted h-4 w-20 animate-pulse rounded" />
      </div>
    </Card>
  </div>
</template>
