import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { Component } from 'vue';

export { default as PillTabs } from './pill-tabs.vue';

/**
 * Discriminated union: `iconClass` is only meaningful when an `icon` is set —
 * declaring `iconClass` without an `icon` would silently do nothing.
 */
export type PillTabItem = {
  value: string;
  label: string;
  disabled?: boolean;
  count?: number;
} & ({ icon?: undefined; iconClass?: never } | { icon: Component; iconClass?: string });

export const pillTabsContainerVariants = cva(
  'bg-muted border-border/50 relative inline-flex items-center self-start overflow-x-auto border no-scrollbar max-w-full',
  {
    variants: {
      size: {
        sm: 'rounded-lg px-1 py-0.5',
        default: 'rounded-md p-1',
        lg: 'h-10 rounded-xl px-1',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export const pillTabsIndicatorVariants = cva(
  'bg-card dark:bg-background absolute rounded-md shadow-sm transition-all duration-200 ease-out',
  {
    variants: {
      size: {
        sm: 'top-0.5 bottom-0.5',
        default: 'top-1 bottom-1',
        lg: 'top-1 bottom-1',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export const pillTabsTriggerVariants = cva(
  'focus-visible:bg-background/50 relative z-1 rounded-md whitespace-nowrap transition-colors focus-visible:outline-none',
  {
    variants: {
      size: {
        sm: 'px-3 py-0.5 text-sm',
        default: 'px-3 py-1.5 text-sm font-medium',
        lg: 'h-8 px-4 text-sm font-medium',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export type PillTabsSize = VariantProps<typeof pillTabsContainerVariants>['size'];
