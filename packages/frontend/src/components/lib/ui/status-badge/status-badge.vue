<script setup lang="ts">
import { cn } from '@/lib/utils';

import type { Variant } from './status-badge';

defineProps<{ variant: Variant }>();

const VARIANT_CLASSES: Record<Variant, { pill: string; dot: string }> = {
  success: { pill: 'border-success-text/25 bg-success-text/10 text-success-text', dot: 'bg-success-text' },
  destructive: { pill: 'border-destructive/25 bg-destructive/10 text-destructive-text', dot: 'bg-destructive' },
  warning: { pill: 'border-warning-text/25 bg-warning-text/10 text-warning-text', dot: 'bg-warning-text' },
  info: { pill: 'border-primary/25 bg-primary/10 text-primary-text', dot: 'bg-primary' },
  neutral: { pill: 'border-border text-muted-foreground', dot: '' },
};
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        VARIANT_CLASSES[variant].pill,
      )
    "
  >
    <span
      v-if="variant !== 'neutral'"
      :class="cn('size-1.5 rounded-full', VARIANT_CLASSES[variant].dot)"
      aria-hidden="true"
    />
    <slot />
  </span>
</template>
