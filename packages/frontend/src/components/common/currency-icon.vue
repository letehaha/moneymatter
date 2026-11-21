<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import { resolveCurrencyDisplay } from '@/js/helpers/currency-decimals';
import { currencyMonogram } from '@/js/helpers/currency-monogram';
import { getCurrencyIcon } from '@/js/helpers/currencyImage';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores/currencies';
import type { CurrencyMeta } from '@bt/shared/types';
import { computed, ref, useAttrs, watch } from 'vue';

defineOptions({ inheritAttrs: false });

/** Tailwind sizing utilities the icon is laid out against. */
type CurrencyIconSize = 'size-3.5' | 'size-5' | 'size-8';

/** Characters of the monogram each size has room for at a legible font size. */
const MONOGRAM_MAX_LENGTH: Record<CurrencyIconSize, number> = {
  'size-3.5': 1,
  'size-5': 2,
  'size-8': 3,
};

const MONOGRAM_FONT_CLASS: Record<CurrencyIconSize, string> = {
  'size-3.5': 'text-xs',
  'size-5': 'text-xs',
  'size-8': 'text-sm',
};

const props = withDefaults(
  defineProps<{
    code: string;
    size?: CurrencyIconSize;
    /** The account owner's definition of the code, when the icon sits on a shared account. */
    meta?: CurrencyMeta | null;
  }>(),
  { size: 'size-5', meta: null },
);

const attrs = useAttrs();
const currenciesStore = useCurrenciesStore();

const display = computed(() => resolveCurrencyDisplay({ code: props.code, meta: props.meta }));
const isCustom = computed(() => display.value.isCustom);

// The logo belongs to the user's own definition of the code, so only their currency list carries it.
const customLogo = computed(() => {
  const holding = isCustom.value ? currenciesStore.currenciesMap[props.code] : undefined;
  return holding ? toLogoSelection(holding) : null;
});

const flagFailed = ref(false);

watch(
  () => props.code,
  () => {
    flagFailed.value = false;
  },
);

const flagUrl = computed(() =>
  flagFailed.value || !props.code || isCustom.value ? null : getCurrencyIcon(props.code),
);

const monogram = computed(() =>
  currencyMonogram({ code: props.code, symbol: display.value.symbol, maxLength: MONOGRAM_MAX_LENGTH[props.size] }),
);
</script>

<template>
  <span
    v-if="customLogo"
    role="img"
    :aria-label="code"
    :class="cn('inline-flex shrink-0', attrs.class as string | undefined)"
    data-testid="currency-icon-logo"
  >
    <BrandLogo
      v-bind="toLogoDisplayProps({ selection: customLogo })"
      :name="monogram"
      :class="cn('rounded-full', size)"
    />
  </span>
  <img
    v-else-if="flagUrl"
    :src="flagUrl"
    :alt="code"
    :class="cn('shrink-0 rounded-full object-cover', size, attrs.class as string | undefined)"
    loading="lazy"
    data-testid="currency-icon-image"
    @error="flagFailed = true"
  />
  <span
    v-else
    role="img"
    :aria-label="code"
    :class="
      cn(
        MONOGRAM_FONT_CLASS[size],
        'bg-muted-foreground/15 text-foreground inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-semibold tracking-tighter select-none',
        size,
        attrs.class as string | undefined,
      )
    "
    data-testid="currency-icon-monogram"
  >
    {{ monogram }}
  </span>
</template>
