<script setup lang="ts">
import TagIcon from '@/components/common/icons/tag-icon.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Button } from '@/components/lib/ui/button';
import { type Component, computed } from 'vue';

const props = defineProps<{
  items: { id: string; name: string; color: string; icon?: string | null }[];
  countLabel: string;
  countIcon: Component;
}>();

const VISIBLE_CHIPS = 2;

const shown = computed(() => props.items.slice(0, VISIBLE_CHIPS));
const hidden = computed(() => props.items.slice(VISIBLE_CHIPS));

const chipClass = 'bg-muted inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium';
const triggerClass = 'bg-muted hover:bg-muted/70 h-auto gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium';
</script>

<template>
  <template v-if="items.length">
    <span class="hidden @md/tracker:contents">
      <span v-for="item in shown" :key="item.id" :class="chipClass">
        <TagIcon v-if="item.icon" :name="item.icon" class="size-3.5" :style="{ color: item.color }" />
        <span v-else class="size-2.5 rounded-full" :style="{ backgroundColor: item.color }" />
        {{ item.name }}
      </span>
      <ResponsiveTooltip v-if="hidden.length" content-class-name="max-w-64" :delay-duration="100">
        <Button variant="ghost" :class="triggerClass">+{{ hidden.length }}</Button>
        <template #content>
          <ul class="flex flex-col gap-1.5">
            <li v-for="item in hidden" :key="item.id" class="flex items-center gap-2 text-sm">
              <TagIcon v-if="item.icon" :name="item.icon" class="size-3.5 shrink-0" :style="{ color: item.color }" />
              <span v-else class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
              {{ item.name }}
            </li>
          </ul>
        </template>
      </ResponsiveTooltip>
    </span>

    <span class="contents @md/tracker:hidden">
      <ResponsiveTooltip content-class-name="max-w-64" :delay-duration="100">
        <Button variant="ghost" :class="triggerClass">
          <component :is="countIcon" class="size-4" />
          {{ countLabel }}
        </Button>
        <template #content>
          <ul class="flex flex-col gap-1.5">
            <li v-for="item in items" :key="item.id" class="flex items-center gap-2 text-sm">
              <TagIcon v-if="item.icon" :name="item.icon" class="size-3.5 shrink-0" :style="{ color: item.color }" />
              <span v-else class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
              {{ item.name }}
            </li>
          </ul>
        </template>
      </ResponsiveTooltip>
    </span>
  </template>
</template>
