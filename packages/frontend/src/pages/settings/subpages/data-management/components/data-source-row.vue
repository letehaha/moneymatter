<template>
  <component
    :is="tag"
    v-bind="linkProps"
    class="group focus-visible:ring-ring hover:bg-hover flex items-center gap-4 px-4 py-3.5 transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
  >
    <div
      :class="
        cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
          iconSrc
            ? 'overflow-hidden bg-white'
            : dashed
              ? 'border-border text-muted-foreground border border-dashed'
              : accent
                ? 'bg-primary/10 text-primary-text'
                : 'bg-muted text-muted-foreground',
        )
      "
    >
      <img v-if="iconSrc" :src="iconSrc" alt="" class="size-full object-contain p-1" />
      <component v-else :is="icon" class="size-5" aria-hidden="true" />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center gap-2">
        <span class="truncate font-medium">{{ title }}</span>
        <span
          v-if="badge"
          class="bg-primary/10 text-primary-text shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
        >
          {{ badge }}
        </span>
      </div>
      <span v-if="description" class="text-muted-foreground mt-0.5 truncate text-sm">
        {{ description }}
      </span>
    </div>

    <component
      :is="isExternal ? ArrowUpRightIcon : ChevronRightIcon"
      aria-hidden="true"
      :class="
        cn(
          'size-4 shrink-0 transition-[color,transform] duration-200 group-hover:translate-x-0.5',
          accent
            ? 'text-muted-foreground group-hover:text-primary-text'
            : 'text-muted-foreground/70 group-hover:text-foreground',
        )
      "
    />
  </component>
</template>

<script setup lang="ts">
import { cn } from '@/lib/utils';
import { ArrowUpRightIcon, ChevronRightIcon } from '@lucide/vue';
import { type Component, computed } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';

defineOptions({
  name: 'data-source-row',
});

const props = defineProps<{
  /** Lucide icon component for the tile. Provide this OR `iconSrc`. */
  icon?: Component;
  /** Brand logo image URL, rendered on a white tile. Takes precedence over `icon`. */
  iconSrc?: string;
  title: string;
  description?: string;
  /** Primary-tinted icon tile + accent trailing chevron — use for the highlighted/main option. */
  accent?: boolean;
  /** Dashed "add"-style icon tile — use for the request-more-options CTA. */
  dashed?: boolean;
  /** Small pill rendered next to the title (e.g. "AI-powered"). */
  badge?: string;
  /** Internal route target. Mutually exclusive with `href`. */
  to?: RouteLocationRaw;
  /** External URL — opens in a new tab and renders an outbound arrow instead of a chevron. */
  href?: string;
}>();

const isExternal = computed(() => Boolean(props.href));
const tag = computed(() => (props.href ? 'a' : RouterLink));
const linkProps = computed(() =>
  props.href ? { href: props.href, target: '_blank', rel: 'noopener noreferrer' } : { to: props.to },
);
</script>
