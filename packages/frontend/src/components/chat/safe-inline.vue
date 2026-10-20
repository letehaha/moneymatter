<script setup lang="ts">
import type { SafeInline } from './safe-text-parser';

defineProps<{ nodes: SafeInline[] }>();
</script>

<template>
  <template v-for="(node, index) in nodes" :key="index">
    <strong v-if="node.type === 'bold'">{{ node.text }}</strong>
    <em v-else-if="node.type === 'italic'">{{ node.text }}</em>
    <code v-else-if="node.type === 'code'" class="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{{
      node.text
    }}</code>
    <template v-else>{{ node.text }}</template>
  </template>
</template>
