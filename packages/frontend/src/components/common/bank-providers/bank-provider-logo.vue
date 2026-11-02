<template>
  <img
    :class="[cn('size-10', $attrs.class as string)]"
    :src="currentTheme === Themes.dark ? logos[provider].icon.dark : logos[provider].icon.light"
  />
</template>

<script setup lang="ts">
import { Themes, currentTheme } from '@/common/utils/color-theme';
import { cn } from '@/lib/utils';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';

const logos: Record<BANK_PROVIDER_TYPE, { icon: { dark: string; light: string } }> = {
  [BANK_PROVIDER_TYPE.ENABLE_BANKING]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/idJpLeYSIH/w/994/h/1041/theme/light/logo.png?c=1bxid64Mup7aczewSAYMX&t=1762089232186',
      light:
        'https://cdn.brandfetch.io/idJpLeYSIH/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1762089232284',
    },
  },
  [BANK_PROVIDER_TYPE.MONOBANK]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/id-CBRc8NA/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1674203441813',
      light:
        'https://cdn.brandfetch.io/id-CBRc8NA/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1674203441813',
    },
  },
  [BANK_PROVIDER_TYPE.LUNCHFLOW]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/lunchflow.app/w/400/h/400/theme/light/icon.jpeg',
      light: 'https://cdn.brandfetch.io/lunchflow.app/w/400/h/400/theme/dark/icon.jpeg',
    },
  },
  [BANK_PROVIDER_TYPE.WALUTOMAT]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/idMxRWw7fO/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1765355825327',
      light:
        'https://cdn.brandfetch.io/idMxRWw7fO/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1765355825327',
    },
  },
  [BANK_PROVIDER_TYPE.SIMPLEFIN]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/simplefin.org/w/400/h/400/theme/light/icon.jpeg',
      light: 'https://cdn.brandfetch.io/simplefin.org/w/400/h/400/theme/dark/icon.jpeg',
    },
  },
  [BANK_PROVIDER_TYPE.AKAHU]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/akahu.io/w/400/h/400/theme/light/icon.jpeg',
      light: 'https://cdn.brandfetch.io/akahu.io/w/400/h/400/theme/dark/icon.jpeg',
    },
  },
  [BANK_PROVIDER_TYPE.YAXI]: {
    icon: {
      dark: 'https://cdn.brandfetch.io/yaxi.tech/w/400/h/400/theme/light/icon.jpeg',
      light: 'https://cdn.brandfetch.io/yaxi.tech/w/400/h/400/theme/dark/icon.jpeg',
    },
  },
};

defineProps<{ provider: BANK_PROVIDER_TYPE }>();
</script>
