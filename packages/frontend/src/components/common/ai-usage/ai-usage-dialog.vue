<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { AI_ALLOWANCE_TEXT_CLASS, useAiAllowance } from '@/composable/use-ai-allowance';
import { useIsAiUsageExitPage } from '@/composable/use-close-dialog-when';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { CalendarIcon, PlugIcon, SparklesIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import AiUsageBar from './ai-usage-bar.vue';

const open = defineModel<boolean>('open', { default: false });

const { allowance, usedPercent, tone, resetDate } = useAiAllowance();
const { canSeeBilling } = storeToRefs(useUserStore());
const isExitPage = useIsAiUsageExitPage();

const isTrial = computed(() => allowance.value?.plan === 'trial');

const secondOption = computed(() =>
  isTrial.value
    ? {
        icon: SparklesIcon,
        titleKey: 'aiUsage.options.subscribeTitle',
        descriptionKey: 'aiUsage.options.subscribeDescription',
      }
    : { icon: CalendarIcon, titleKey: 'aiUsage.options.waitTitle', descriptionKey: 'aiUsage.options.waitDescription' },
);

const STATUS_KEYS = {
  plus: {
    warning: 'aiUsage.dialog.status.plusWarning',
    reached: 'aiUsage.dialog.status.plusReached',
  },
  trial: {
    warning: 'aiUsage.dialog.status.trialWarning',
    reached: 'aiUsage.dialog.status.trialReached',
  },
} as const;

const statusKey = computed(() => {
  if (!allowance.value || allowance.value.state === 'ok') return null;
  return STATUS_KEYS[allowance.value.plan][allowance.value.state];
});
</script>

<template>
  <ResponsiveDialog v-model:open="open" :close-when="isExitPage" dialog-content-class="sm:max-w-lg">
    <template #title>{{ $t('aiUsage.title') }}</template>
    <template #description>{{ $t('aiUsage.dialog.description') }}</template>

    <div v-if="allowance" class="grid gap-4">
      <div class="grid gap-2">
        <div class="flex items-baseline gap-2">
          <span :class="cn('text-3xl font-bold tabular-nums', AI_ALLOWANCE_TEXT_CLASS[tone])">
            {{ usedPercent }}%
          </span>
          <span class="text-muted-foreground text-sm">{{ $t('aiUsage.used') }}</span>
          <span class="text-muted-foreground ml-auto text-xs">{{ $t('aiUsage.resetsOn', { date: resetDate }) }}</span>
        </div>
        <AiUsageBar :used-percent="usedPercent" :tone="tone" />
      </div>

      <p v-if="statusKey" class="text-sm leading-relaxed">{{ $t(statusKey, { date: resetDate }) }}</p>

      <div class="grid gap-2">
        <div class="flex gap-3 rounded-lg border p-3">
          <span class="bg-primary/10 text-primary-text flex size-8 shrink-0 items-center justify-center rounded-md">
            <PlugIcon class="size-4" />
          </span>
          <div>
            <p class="text-sm font-semibold">{{ $t('aiUsage.connectOwnModel') }}</p>
            <p class="text-muted-foreground mt-0.5 text-sm">{{ $t('aiUsage.options.connectDescription') }}</p>
          </div>
        </div>
        <div class="flex gap-3 rounded-lg border p-3">
          <span class="bg-primary/10 text-primary-text flex size-8 shrink-0 items-center justify-center rounded-md">
            <component :is="secondOption.icon" class="size-4" />
          </span>
          <div>
            <p class="text-sm font-semibold">{{ $t(secondOption.titleKey) }}</p>
            <p class="text-muted-foreground mt-0.5 text-sm">
              {{ $t(secondOption.descriptionKey, { date: resetDate }) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <template #footer="{ close }">
      <Button v-if="!isTrial" variant="outline" @click="close">
        {{ allowance?.state === 'reached' ? $t('common.ui.close') : $t('aiUsage.gotIt') }}
      </Button>
      <Button :variant="isTrial ? 'outline' : 'default'" as-child>
        <RouterLink :to="{ name: ROUTES_NAMES.settingsAiModels }" @click="close">
          {{ $t('aiUsage.connectOwnModel') }}
        </RouterLink>
      </Button>
      <Button v-if="isTrial && canSeeBilling" as-child>
        <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }" @click="close">
          {{ $t('billing.seePlans') }}
        </RouterLink>
      </Button>
    </template>
  </ResponsiveDialog>
</template>
