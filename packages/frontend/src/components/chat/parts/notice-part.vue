<script setup lang="ts">
import type { ChatNoticePart } from '@bt/shared/types';
import { computed } from 'vue';

import { useChatText } from '../chat-text';

const props = defineProps<{ part: ChatNoticePart }>();

const { keyText } = useChatText();

/** The server sends a key and parameters; a key this build does not know reads as a generic line, not as the key. */
const text = computed(() =>
  keyText({ key: props.part.key, params: props.part.params, fallbackKey: 'chat.notices.unknown' }),
);
</script>

<template>
  <p role="status" class="text-muted-foreground text-xs italic">{{ text }}</p>
</template>
