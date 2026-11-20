import { cn } from '@/lib/utils';

/**
 * Shared chrome for the Pivot Report filter pills. Exposed as a plain function so
 * the self-triggering filter components (categories / payees / accounts) can apply
 * the identical pill styling through their `triggerClass` prop and stay visually
 * consistent with the Period pill that `filter-pill.vue` renders. `active` tints the
 * pill to signal the filter is narrowing the report beyond its wide-open default.
 */
export const filterPillClass = ({ active }: { active: boolean }): string =>
  cn(
    'flex h-9 min-h-9 w-auto max-w-full min-w-0 items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-normal',
    active
      ? 'border-primary/60 bg-primary/10 text-foreground hover:bg-primary/15'
      : 'border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground',
  );
