<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { formatAccountAmount, toLocalCurrencyNumber } from '@/js/helpers/formatters';
import type { CurrencyMeta } from '@bt/shared/types';
import { computed } from 'vue';

const props = defineProps<{
  amount: number;
  /** Whatever carries the currency: an account, a transaction or a transfer leg. */
  owner: { currencyCode: string; currencyMeta?: CurrencyMeta | null };
  /** The number alone, for layouts that render the code separately. */
  bare?: boolean;
  /** Reveal the full amount on tap too. Leave off inside clickable rows, where a tap opens the row. */
  responsive?: boolean;
}>();

const fullAmount = computed(() =>
  formatAccountAmount({ amount: props.amount, account: props.owner, fullPrecision: true }),
);
const isShortened = computed(
  () => formatAccountAmount({ amount: props.amount, account: props.owner }) !== fullAmount.value,
);
const shown = computed(() =>
  props.bare
    ? toLocalCurrencyNumber(props.amount, { currency: props.owner.currencyCode, meta: props.owner.currencyMeta })
    : formatAccountAmount({ amount: props.amount, account: props.owner }),
);
</script>

<template>
  <component :is="responsive ? ResponsiveTooltip : DesktopOnlyTooltip" v-if="isShortened" :content="fullAmount">
    <span class="cursor-help underline decoration-dotted underline-offset-4">{{ shown }}</span>
  </component>
  <template v-else>{{ shown }}</template>
</template>
