<script setup lang="ts">
import { splitTextLinks } from '@/common/utils/external-url';
import { computed } from 'vue';

const props = defineProps<{ text: string }>();

const parts = computed(() => splitTextLinks({ text: props.text }));
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <a
      v-if="part.isLink"
      :href="part.text"
      target="_blank"
      rel="noopener noreferrer"
      class="text-primary-text underline-offset-4 hover:underline"
      @click.stop
      >{{ part.text }}</a
    >
    <template v-else>{{ part.text }}</template>
  </template>
</template>
