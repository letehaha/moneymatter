<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import type { ChatAnalysisInputSource, ChatAnalysisPart } from '@bt/shared/types';
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ part: ChatAnalysisPart }>();

/** A result can be large; the sandbox caps it, and the page shows the start of it. */
const OUTPUT_MAX_CHARS = 20_000;

const { t } = useI18n();
const isOpen = ref(false);

const outputText = computed(() => {
  if (props.part.output === undefined) return null;

  const text = typeof props.part.output === 'string' ? props.part.output : JSON.stringify(props.part.output, null, 2);
  return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}…` : text;
});

const sourceText = ({ source }: { source: ChatAnalysisInputSource }) =>
  'tool' in source ? t('chat.parts.analysis.tool', { tool: source.tool }) : t('chat.parts.analysis.fromCall');
</script>

<template>
  <div class="text-sm">
    <Button
      variant="link"
      size="sm"
      class="h-auto p-0"
      data-testid="analysis-toggle"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      {{ $t('chat.parts.analysis.title') }}
      <span class="text-muted-foreground font-normal">
        · {{ $t(`chat.parts.analysis.${part.status}`) }}
        <template v-if="part.durationMs !== undefined">
          · {{ $t('chat.parts.toolCalls.duration', { ms: part.durationMs }) }}</template
        >
      </span>
      <component :is="isOpen ? ChevronUpIcon : ChevronDownIcon" class="size-4" aria-hidden="true" />
    </Button>

    <div v-if="isOpen" class="mt-2 flex flex-col gap-3">
      <div>
        <p class="text-muted-foreground mb-1 text-xs font-medium">{{ $t('chat.parts.analysis.code') }}</p>
        <pre class="bg-muted/40 overflow-x-auto rounded-md p-3 text-xs" data-testid="analysis-code">{{
          part.code
        }}</pre>
      </div>

      <div v-if="part.inputs.length > 0">
        <p class="text-muted-foreground mb-1 text-xs font-medium">{{ $t('chat.parts.analysis.inputs') }}</p>
        <ul class="flex flex-col gap-0.5 text-xs">
          <li v-for="input in part.inputs" :key="input.name">
            <span class="font-mono">{{ input.name }}</span>
            <span class="text-muted-foreground"> · {{ sourceText({ source: input.source }) }}</span>
          </li>
        </ul>
      </div>

      <div v-if="outputText !== null">
        <p class="text-muted-foreground mb-1 text-xs font-medium">{{ $t('chat.parts.analysis.output') }}</p>
        <pre class="bg-muted/40 overflow-x-auto rounded-md p-3 text-xs" data-testid="analysis-output">{{
          outputText
        }}</pre>
      </div>

      <p v-if="part.error" class="text-destructive-text text-xs wrap-anywhere" data-testid="analysis-error">
        {{ part.error }}
      </p>
    </div>
  </div>
</template>
