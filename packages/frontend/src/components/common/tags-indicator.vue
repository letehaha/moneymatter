<template>
  <template v-if="tags.length > 0">
    <ResponsiveTooltip v-if="variant === 'rails'" :delay-duration="100">
      <span
        class="-m-1.5 inline-flex shrink-0 cursor-help items-center gap-0.75 p-1.5"
        role="img"
        :aria-label="railsAriaLabel"
        data-testid="tags-indicator-rails"
        @click="isTouch && $event.stopPropagation()"
      >
        <span
          v-for="tag in visibleRails"
          :key="tag.id"
          class="block h-3 w-1.25 rounded-full"
          :style="{ backgroundColor: tag.color }"
        />
        <span v-if="hiddenRailsCount > 0" class="text-muted-foreground ml-0.75 text-[10px]">
          +{{ hiddenRailsCount }}
        </span>
      </span>
      <template #content>
        <div class="flex flex-col gap-1">
          <span v-for="tag in sortedTags" :key="tag.id" class="flex items-center gap-2 text-xs">
            <span class="size-2 shrink-0 rounded-xs" :style="{ backgroundColor: tag.color }" />
            {{ tag.name }}
          </span>
        </div>
      </template>
    </ResponsiveTooltip>

    <div v-else class="flex min-w-0 items-center gap-1">
      <!-- Chips that don't fit wrap onto a clipped second line. max-w bounds the list so it can wrap in content-sized rows. -->
      <div :ref="setListRef" class="flex h-4 max-w-28 min-w-0 flex-wrap gap-1 overflow-hidden">
        <span
          v-for="tag in tags"
          :key="tag.id"
          class="inline-block max-w-full truncate rounded-full px-1.5 text-[10px] leading-4 font-medium text-white/90"
          :style="{ backgroundColor: tag.color }"
        >
          {{ tag.name }}
        </span>
      </div>
      <span v-if="hiddenTagsCount > 0" class="text-muted-foreground shrink-0 text-[10px]">+{{ hiddenTagsCount }}</span>
    </div>
  </template>
</template>

<script lang="ts" setup>
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { useFittingChips } from '@/composable/use-fitting-chips';
import { TagModel } from '@bt/shared/types';
import { useMediaQuery } from '@vueuse/core';
import { computed } from 'vue';

export type TagsIndicatorVariant = 'chips' | 'rails';

const MAX_VISIBLE_RAILS = 4;

// On touch the tooltip opens on tap, which would also open the transaction behind it.
const isTouch = useMediaQuery('(pointer: coarse)');

const props = withDefaults(
  defineProps<{
    tags: TagModel[];
    variant?: TagsIndicatorVariant;
  }>(),
  { variant: 'chips' },
);

const { setListRef, hiddenCount: hiddenTagsCount } = useFittingChips({ items: () => props.tags });

// Sorted by name so the same set of tags always renders in the same order.
const sortedTags = computed(() => [...props.tags].sort((a, b) => a.name.localeCompare(b.name)));
const visibleRails = computed(() => sortedTags.value.slice(0, MAX_VISIBLE_RAILS));
const hiddenRailsCount = computed(() => Math.max(props.tags.length - MAX_VISIBLE_RAILS, 0));
const railsAriaLabel = computed(() => sortedTags.value.map((tag) => tag.name).join(', '));
</script>
