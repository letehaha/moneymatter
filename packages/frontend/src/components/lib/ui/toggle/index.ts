import { controlHeight } from '@/components/lib/ui/control-size';
import { cva } from 'class-variance-authority';

export { default as Toggle } from './Toggle.vue';

export const toggleVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-hover hover:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-hover hover:text-accent-foreground',
      },
      size: {
        default: `${controlHeight.default} px-3`,
        sm: `${controlHeight.sm} px-2.5`,
        lg: `${controlHeight.lg} px-5`,
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
