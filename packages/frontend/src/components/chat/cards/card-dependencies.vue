<script setup lang="ts">
import { useChatText } from '../chat-text';
import type { ChainParent } from './card-chain';

defineProps<{ parents: ChainParent[] }>();

const { titleText } = useChatText();
</script>

<template>
  <div v-if="parents.length > 0" class="text-muted-foreground text-sm">
    <p class="font-medium">{{ $t('chat.cards.dependencies.title') }}</p>
    <ul class="mt-1 list-disc pl-5">
      <li v-for="parent in parents" :key="parent.id">{{ titleText({ title: parent.title }) }}</li>
    </ul>
  </div>
</template>
