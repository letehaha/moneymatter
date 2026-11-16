import { controlHeight } from '@/components/lib/ui/control-size';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva(
  'inline-flex gap-2 items-center justify-center rounded-md whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-button hover:bg-primary/90 active:shadow-none',
        destructive:
          'bg-destructive text-destructive-foreground shadow-button hover:bg-destructive/90 active:shadow-none',
        outline:
          'border border-input bg-(--button-outline-background) shadow-(--button-raised-shadow) hover:bg-hover hover:text-accent-foreground active:bg-muted active:shadow-none dark:active:bg-accent',
        secondary:
          'bg-(--button-secondary-background) text-secondary-foreground inset-ring inset-ring-input shadow-(--button-raised-shadow) hover:bg-(--button-secondary-hover) active:bg-muted active:shadow-none dark:active:bg-secondary-hover',
        field: 'border border-input bg-input-background font-normal',
        ghost: 'hover:bg-hover hover:text-accent-foreground',
        'ghost-destructive': 'text-destructive-text hover:bg-destructive/20 hover:text-destructive-text',
        'soft-destructive': 'bg-destructive/15 text-destructive-text hover:bg-destructive/25',
        'ghost-primary': 'text-primary-text hover:bg-primary/10 hover:text-primary-text',
        'soft-primary': 'bg-primary/15 text-primary-text hover:bg-primary/25',
        success: 'bg-success text-success-foreground shadow-button hover:bg-success/90 active:shadow-none',
        'outline-success': 'border border-success-text/30 text-success-text bg-background hover:bg-success-text/10',
        'ghost-success': 'text-success-text hover:bg-success-text/10 hover:text-success-text',
        'soft-success': 'bg-success-text/15 text-success-text hover:bg-success-text/25',
        link: 'text-primary-text underline-offset-4 hover:underline',
      },
      size: {
        default: `${controlHeight.default} px-4 py-2`,
        xs: `${controlHeight.xs} rounded-md px-3`,
        sm: `${controlHeight.sm} rounded-md px-3`,
        lg: `${controlHeight.lg} rounded-md px-8`,
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonVariantProps extends VariantProps<typeof buttonVariants> {}
