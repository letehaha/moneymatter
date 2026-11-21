<script setup lang="ts">
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { formatTinyUIAmount, formatUIAmount } from '@/js/helpers';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

const props = defineProps<{
  /** Amount in the user's base currency. */
  amount: number;
  /** Base currency code the amount is denominated in. */
  currencyCode: string;
  /** Prefix the amount with "≈" because it rolls up figures converted from other currencies. */
  isApprox?: boolean;
  /** Heavier weight for top-level section headers vs. nested group rows. */
  emphasis?: boolean;
  /** Placeholder while the underlying amounts are still loading. */
  loading?: boolean;
  /** Render the amount even when it rounds to zero, instead of hiding the row's value. */
  showZero?: boolean;
  /** Merged last, so callers can override the default size and neutral color. */
  textClass?: string;
  /** Whole units and one-decimal K/M/B, for narrow spots like the sidebar. */
  tiny?: boolean;
}>();

const { formatCompactAmount } = useFormatCurrency();

// A total that renders as zero carries no information, so the row stays clean
// instead of showing "≈$0.00" for empty or netted-out groups.
const isZero = computed(() =>
  props.tiny
    ? Math.round(props.amount) === 0
    : Math.abs(props.amount) < 0.5 / 10 ** getCurrencyDecimals({ code: props.currencyCode }),
);

const prefix = computed(() => (props.isApprox ? '≈ ' : ''));
const compact = computed(
  () =>
    `${prefix.value}${
      props.tiny
        ? formatTinyUIAmount({ amount: props.amount, currency: props.currencyCode })
        : formatCompactAmount(props.amount, props.currencyCode)
    }`,
);
const full = computed(
  () => `${prefix.value}${formatUIAmount(props.amount, { currency: props.currencyCode, fullPrecision: true })}`,
);
</script>

<template>
  <span v-if="loading" class="bg-muted/30 inline-block h-3.5 w-14 max-w-full shrink-0 animate-pulse rounded" />
  <DesktopOnlyTooltip v-else-if="!isZero || showZero" :content="full">
    <span
      :class="
        cn(
          'text-amount shrink-0 text-sm tabular-nums',
          amount < 0 ? 'text-destructive-text' : 'text-foreground',
          emphasis && 'font-medium',
          textClass,
        )
      "
    >
      {{ compact }}
    </span>
  </DesktopOnlyTooltip>
</template>
