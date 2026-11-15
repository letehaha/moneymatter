<script setup lang="ts">
import { computed } from 'vue';

import SafeInlineNodes from './safe-inline.vue';
import { parseSafeText } from './safe-text-parser';

/**
 * Renders model text. Every node is built from the parser's plain data and interpolated as text, so
 * markup in the answer shows up as characters; there is no `v-html`, no link and no image.
 */
const props = defineProps<{ text: string }>();

const blocks = computed(() => parseSafeText({ text: props.text }));
</script>

<template>
  <div class="flex flex-col gap-2 text-sm leading-relaxed wrap-anywhere">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <ul v-if="block.type === 'list'" class="list-disc space-y-1 pl-5">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <SafeInlineNodes :nodes="item" />
        </li>
      </ul>
      <p v-else>
        <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
          <br v-if="lineIndex > 0" />
          <SafeInlineNodes :nodes="line" />
        </template>
      </p>
    </template>
  </div>
</template>
