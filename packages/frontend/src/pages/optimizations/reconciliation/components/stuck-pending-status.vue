<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { StuckPendingItem } from '@bt/shared/types/endpoints';
import { InfoIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ item: StuckPendingItem }>();

const I18N = 'optimizations.reconciliation.stuckPending.status';
const TOOLTIP_CLASS = 'w-fit max-w-[min(320px,calc(100vw-2rem))] text-pretty';

const { t } = useI18n();
const { format } = useDateLocale();

const status = computed(() => {
  const { canCheckWithBank, candidate } = props.item;
  if (!canCheckWithBank) {
    return { tone: 'text-muted-foreground', title: t(`${I18N}.tooOld`), hint: t(`${I18N}.tooOldHint`) };
  }
  if (candidate) {
    return {
      tone: 'text-primary-text',
      title: t(`${I18N}.duplicate`),
      hint: t(`${I18N}.duplicateHint`, { date: format(candidate.time, 'd MMM') }),
    };
  }
  return { tone: 'text-warning-text', title: t(`${I18N}.notFound`), hint: t(`${I18N}.notFoundHint`) };
});
</script>

<template>
  <ResponsiveTooltip :delay-duration="100" :content="status.hint" :content-class-name="TOOLTIP_CLASS">
    <span
      tabindex="0"
      :class="
        cn('inline-flex w-fit cursor-help items-center gap-1.5 text-xs font-semibold whitespace-nowrap', status.tone)
      "
    >
      {{ status.title }}
      <InfoIcon class="size-3.5 opacity-70" />
    </span>
  </ResponsiveTooltip>
</template>
