<template>
  <Collapsible v-if="$slots.default" v-slot="{ open }" :default-open="defaultOpen" class="rounded-lg border">
    <CollapsibleTrigger class="hover:bg-hover flex w-full items-center gap-3 p-3 text-left transition-colors">
      <div
        class="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      >
        {{ step }}
      </div>
      <span class="flex-1 font-semibold">
        <slot name="title">{{ title }}</slot>
      </span>
      <ChevronDownIcon :class="cn('size-5 shrink-0 transition-transform duration-200', open && 'rotate-180')" />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div :class="cn('text-muted-foreground border-t px-3 py-3 pl-12', contentClass)">
        <slot />
      </div>
    </CollapsibleContent>
  </Collapsible>

  <div v-else class="flex items-start gap-3 rounded-lg border p-3">
    <div
      class="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
    >
      {{ step }}
    </div>
    <span class="flex-1 text-sm">
      <slot name="title">{{ title }}</slot>
    </span>
  </div>
</template>

<script lang="ts" setup>
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { cn } from '@/lib/utils';
import { ChevronDownIcon } from '@lucide/vue';
import type { HTMLAttributes } from 'vue';

defineProps<{
  step: number;
  title?: string;
  defaultOpen?: boolean;
  contentClass?: HTMLAttributes['class'];
}>();
</script>
