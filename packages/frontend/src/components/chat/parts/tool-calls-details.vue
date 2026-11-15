<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import type { ChatToolCallPart } from '@bt/shared/types';
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import { ref } from 'vue';

import { summarizeValue } from '../cards/card-values';

defineProps<{ parts: ChatToolCallPart[] }>();

const isOpen = ref(false);
</script>

<template>
  <div v-if="parts.length > 0" class="text-sm">
    <Button
      variant="link"
      size="sm"
      class="h-auto p-0"
      data-testid="tool-calls-toggle"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      {{ $t('chat.parts.toolCalls.title', { count: parts.length }) }}
      <component :is="isOpen ? ChevronUpIcon : ChevronDownIcon" class="size-4" aria-hidden="true" />
    </Button>

    <ul v-if="isOpen" class="mt-2 flex flex-col gap-2">
      <li v-for="part in parts" :key="part.id" class="bg-muted/40 min-w-0 rounded-md px-3 py-2" data-testid="tool-call">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <span class="font-mono text-xs font-medium">{{ part.toolName }}</span>
          <span class="text-muted-foreground text-xs">
            {{ $t(`chat.parts.toolCalls.${part.status}`) }}
            <template v-if="part.durationMs !== undefined">
              · {{ $t('chat.parts.toolCalls.duration', { ms: part.durationMs }) }}</template
            >
          </span>
        </div>
        <code class="text-muted-foreground block text-xs wrap-anywhere">{{
          summarizeValue({ value: part.args })
        }}</code>
        <p v-if="part.resultSummary" class="text-xs wrap-anywhere">{{ part.resultSummary }}</p>
        <p v-if="part.error" class="text-destructive-text text-xs wrap-anywhere">{{ part.error }}</p>
      </li>
    </ul>
  </div>
</template>
