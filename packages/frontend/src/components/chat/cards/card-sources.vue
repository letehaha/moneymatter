<script setup lang="ts">
import type { ChatSource } from '@bt/shared/types';

import { summarizeValue } from './card-values';

defineProps<{ sources: ChatSource[] }>();
</script>

<template>
  <div class="flex flex-col gap-2 text-sm">
    <p class="text-muted-foreground text-xs font-medium">{{ $t('chat.cards.sources.title') }}</p>

    <p v-if="sources.length === 0" class="text-muted-foreground">{{ $t('chat.cards.sources.empty') }}</p>
    <ul v-else class="flex flex-col gap-1.5">
      <li v-for="(source, index) in sources" :key="index" class="min-w-0">
        <template v-if="source.type === 'toolCall'">
          <span>{{ $t('chat.cards.sources.toolCall', { tool: source.toolName }) }}</span>
          <code class="text-muted-foreground block text-xs wrap-anywhere">{{
            summarizeValue({ value: source.args })
          }}</code>
        </template>
        <span v-else-if="source.type === 'attachment'">
          {{ $t('chat.cards.sources.attachment', { fileName: source.fileName }) }}
        </span>
        <span v-else-if="source.type === 'pageContext'">{{ $t('chat.cards.sources.pageContext') }}</span>
        <span v-else>{{ $t('chat.cards.sources.analysis') }}</span>
      </li>
    </ul>
  </div>
</template>
