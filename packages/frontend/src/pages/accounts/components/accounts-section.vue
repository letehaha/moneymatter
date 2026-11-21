<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <h2 class="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">{{ title }}</h2>
      <span
        v-if="count !== undefined && count !== ''"
        class="text-muted-foreground hidden text-xs font-medium tabular-nums @[30rem]/accounts-page:inline"
      >
        {{ count }}
      </span>
      <div class="ml-auto">
        <slot name="action" />
      </div>
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  count?: number | string;
}>();
</script>
