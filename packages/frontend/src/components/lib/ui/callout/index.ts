import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

export { default as Callout } from './callout.vue';

export const calloutVariants = cva('flex items-start gap-3 rounded-lg border p-3 text-sm', {
  variants: {
    variant: {
      warning: 'bg-warning/10 border-warning/20 text-warning-text',
      destructive: 'bg-destructive/10 border-destructive/20 text-destructive-text',
      success: 'bg-success/10 border-success/20 text-success-text',
      info: 'bg-muted/40 border-border/70 text-muted-foreground',
      primary: 'bg-primary/10 border-primary/20 text-primary-text',
    },
  },
  defaultVariants: {
    variant: 'warning',
  },
});

export const calloutIconClass: Record<NonNullable<VariantProps<typeof calloutVariants>['variant']>, string> = {
  warning: 'text-warning',
  destructive: 'text-destructive-text',
  success: 'text-success-text',
  info: 'text-muted-foreground',
  primary: 'text-primary-text',
};

export interface CalloutVariantProps extends VariantProps<typeof calloutVariants> {}
