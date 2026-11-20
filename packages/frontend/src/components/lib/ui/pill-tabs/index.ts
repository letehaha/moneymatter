import { controlHeight } from '@/components/lib/ui/control-size';
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
  /** E.g. a container query that turns the label `sr-only`, leaving an icon-only tab. */
  labelClass?: string;
  ariaLabel?: string;
  /** CSS colour for the selected label and the indicator behind it. */
  tone?: string;
} & ({ icon?: undefined; iconClass?: never } | { icon: Component; iconClass?: string });

export const pillTabsContainerVariants = cva(
  // Inside a field surface the field is the track, so the tabs drop their own (light theme only: the dark indicator needs the track to show).
  'bg-muted border-border/50 relative inline-flex items-center self-start overflow-x-auto border no-scrollbar max-w-full not-dark:in-[.bg-input-background]:border-transparent not-dark:in-[.bg-input-background]:bg-transparent',
  {
    variants: {
      size: {
        sm: 'rounded-lg px-1 py-0.5',
        default: 'rounded-md p-1',
        lg: `${controlHeight.default} rounded-xl px-1`,
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export const pillTabsIndicatorVariants = cva(
  'bg-card dark:bg-background absolute rounded-md shadow-sm transition-all duration-200 ease-out motion-reduce:transition-none not-dark:in-[.bg-input-background]:inset-ring not-dark:in-[.bg-input-background]:inset-ring-input',
  {
    variants: {
      size: {
        sm: 'top-0.5 bottom-0.5',
        default: 'top-1 bottom-1',
        lg: 'top-0.75 bottom-0.75',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export const pillTabsTriggerVariants = cva(
  'focus-visible:ring-ring relative z-1 rounded-md whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
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
