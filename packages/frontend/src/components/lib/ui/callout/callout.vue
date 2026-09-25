<script setup lang="ts">
import { cn } from '@/lib/utils';
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, type LucideIcon, OctagonAlertIcon } from '@lucide/vue';
import { computed } from 'vue';

import { type CalloutVariantProps, calloutIconClass, calloutVariants } from './index';

interface Props {
  variant?: CalloutVariantProps['variant'];
  title?: string;
  icon?: LucideIcon | null;
  iconSizeClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'warning',
  title: undefined,
  icon: undefined,
  iconSizeClass: 'size-4',
});

const DEFAULT_ICONS: Record<NonNullable<CalloutVariantProps['variant']>, LucideIcon> = {
  warning: AlertTriangleIcon,
  destructive: OctagonAlertIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  primary: InfoIcon,
};

const resolvedIcon = computed<LucideIcon | null>(() => {
  if (props.icon === null) return null;
  return props.icon ?? DEFAULT_ICONS[props.variant!];
});

const iconColorClass = computed(() => calloutIconClass[props.variant!]);
</script>

<template>
  <div :class="cn(calloutVariants({ variant }), $attrs.class ?? '')">
    <component :is="resolvedIcon" v-if="resolvedIcon" :class="cn('mt-0.5 shrink-0', iconSizeClass, iconColorClass)" />
    <div class="min-w-0 flex-1">
      <p v-if="title" class="mb-1 font-medium">{{ title }}</p>
      <slot />
    </div>
  </div>
</template>
