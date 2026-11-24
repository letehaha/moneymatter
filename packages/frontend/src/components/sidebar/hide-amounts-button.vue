<script setup lang="ts">
import UiButton from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { areAmountsHidden } from '@/js/helpers/formatters';
import { EyeIcon, EyeOffIcon } from '@lucide/vue';

withDefaults(defineProps<{ size?: 'icon' | 'icon-sm'; side?: 'top' | 'right' }>(), { size: 'icon-sm', side: 'top' });
</script>

<template>
  <DesktopOnlyTooltip :content="$t('sidebar.hideAmounts')" :side="side">
    <UiButton
      variant="ghost"
      :size="size"
      :aria-label="$t('sidebar.hideAmounts')"
      :aria-pressed="areAmountsHidden"
      @click="areAmountsHidden = !areAmountsHidden"
    >
      <EyeOffIcon v-if="areAmountsHidden" class="size-4" />
      <EyeIcon v-else class="size-4" />
    </UiButton>
  </DesktopOnlyTooltip>
</template>
