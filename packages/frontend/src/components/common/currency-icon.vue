<script setup lang="ts">
import { resolveCurrencyDisplay } from '@/js/helpers/currency-decimals';
import { currencyMonogram } from '@/js/helpers/currency-monogram';
import { getCurrencyIcon } from '@/js/helpers/currencyImage';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores/currencies';
import type { CurrencyMeta } from '@bt/shared/types';
import { computed, ref, useAttrs, watch } from 'vue';

defineOptions({ inheritAttrs: false });

/** Tailwind sizing utilities the icon is laid out against. */
export type CurrencyIconSize = 'size-3.5' | 'size-5' | 'size-8';

/** Pixel edge of each size, which the monogram scales its text from. */
const SIZE_PX: Record<CurrencyIconSize, number> = {
  'size-3.5': 14,
  'size-5': 20,
  'size-8': 32,
};

/** Share of the circle's edge the text takes, by its length: the longer the text, the smaller it gets. */
const MONOGRAM_FONT_RATIO_BY_LENGTH: Record<number, number> = { 1: 0.6, 2: 0.5, 3: 0.4 };
const MONOGRAM_FONT_RATIO_LONGEST = 0.34;

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
const logoUrl = computed(() => (isCustom.value ? (currenciesStore.currenciesMap[props.code]?.logoUrl ?? null) : null));

const imageFailed = ref(false);

// A new code or a new logo gets its own chance to load.
watch([() => props.code, logoUrl], () => {
  imageFailed.value = false;
});

const imageUrl = computed(() => {
  if (imageFailed.value || !props.code) return null;

  return isCustom.value ? logoUrl.value : getCurrencyIcon(props.code);
});

const monogram = computed(() => currencyMonogram({ code: props.code, symbol: display.value.symbol }));
const monogramFontSize = computed(() => {
  const length = Array.from(monogram.value).length;
  const ratio = MONOGRAM_FONT_RATIO_BY_LENGTH[length] ?? MONOGRAM_FONT_RATIO_LONGEST;

  return `${SIZE_PX[props.size] * ratio}px`;
});
</script>

<template>
  <img
    v-if="imageUrl"
    :src="imageUrl"
    :alt="code"
    :class="cn('shrink-0 rounded-full object-cover', size, attrs.class as string | undefined)"
    loading="lazy"
    data-testid="currency-icon-image"
    @error="imageFailed = true"
  />
  <span
    v-else
    role="img"
    :aria-label="code"
    :class="
      cn(
        'bg-muted-foreground/15 text-foreground inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-semibold tracking-tighter select-none',
        size,
        attrs.class as string | undefined,
      )
    "
    :style="{ fontSize: monogramFontSize }"
    data-testid="currency-icon-monogram"
  >
    {{ monogram }}
  </span>
</template>
