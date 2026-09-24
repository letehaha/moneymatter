<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { cn } from '@/lib/utils';
import { ChevronDownIcon } from '@lucide/vue';
import { useLocalStorage } from '@vueuse/core';

const props = defineProps<{ sectionKey: string; title: string }>();

const isOpen = useLocalStorage(`budget-plan-panel:open:${props.sectionKey}`, true);
</script>

<template>
  <Collapsible v-model:open="isOpen">
    <CollapsibleTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="text-primary-text hover:text-primary-text h-7 w-full justify-between px-1 text-xs font-semibold tracking-wide uppercase"
      >
        {{ title }}
        <ChevronDownIcon :class="cn('size-4 transition-transform', !isOpen && '-rotate-90')" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="border-border bg-muted/40 mt-1 rounded-lg border p-3">
        <slot />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
