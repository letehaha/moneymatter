<template>
  <img
    :class="[cn('size-10', $attrs.class as string)]"
    :src="(currentTheme === Themes.dark && darkLogos[provider]) || logos[provider]"
  />
</template>

<script setup lang="ts">
import { Themes, currentTheme } from '@/common/utils/color-theme';
import { cn } from '@/lib/utils';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';

const logos: Record<BANK_PROVIDER_TYPE, string> = {
  [BANK_PROVIDER_TYPE.ENABLE_BANKING]: '/img/logos/enable-banking.webp',
  [BANK_PROVIDER_TYPE.MONOBANK]: '/img/logos/monobank.webp',
  [BANK_PROVIDER_TYPE.LUNCHFLOW]: '/img/logos/lunch-flow.webp',
  [BANK_PROVIDER_TYPE.WALUTOMAT]: '/img/logos/walutomat.webp',
  [BANK_PROVIDER_TYPE.SIMPLEFIN]: '/img/logos/simplefin.webp',
  [BANK_PROVIDER_TYPE.AKAHU]: '/img/logos/akahu.svg',
};

const darkLogos: Partial<Record<BANK_PROVIDER_TYPE, string>> = {
  [BANK_PROVIDER_TYPE.ENABLE_BANKING]: '/img/logos/enable-banking-dark.webp',
};

defineProps<{ provider: BANK_PROVIDER_TYPE }>();
</script>
