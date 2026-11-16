<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { cn } from '@/lib/utils';
import { Link2Icon } from '@lucide/vue';

defineProps<{ count: number }>();
</script>

<template>
  <ResponsiveTooltip :content="$t('planned.subscriptions.linkedTransactions', { count }, count)">
    <Button
      variant="ghost"
      size="xs"
      :aria-label="$t('planned.subscriptions.linkedTransactions', { count }, count)"
      :class="
        cn(
          'text-muted-foreground bg-muted/60 hover:bg-muted min-w-8 gap-1.5 rounded-full px-2.5 text-sm font-medium tabular-nums',
          count === 0 && 'opacity-60',
        )
      "
    >
      <Link2Icon class="size-4 shrink-0" />
      {{ count }}
    </Button>
  </ResponsiveTooltip>
</template>
