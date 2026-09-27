<script setup lang="ts">
import type { ColumnDefinition } from './columns';

defineProps<{ columns: ColumnDefinition[] }>();
</script>

<template>
  <tr class="h-10 divide-x" aria-hidden="true">
    <td class="border-b" />
    <td v-for="column in columns" :key="column.id" class="border-b px-3">
      <div :class="['bg-muted h-3.5 w-3/4 animate-pulse rounded', column.align === 'right' && 'ml-auto']" />
    </td>
    <td class="border-b" />
  </tr>
</template>
