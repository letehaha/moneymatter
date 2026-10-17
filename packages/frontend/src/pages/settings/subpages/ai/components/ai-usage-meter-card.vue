<script setup lang="ts">
import AiUsageBar from '@/components/common/ai-usage/ai-usage-bar.vue';
import { Button } from '@/components/lib/ui/button';
import { AI_ALLOWANCE_TEXT_CLASS, useAiAllowance } from '@/composable/use-ai-allowance';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { storeToRefs } from 'pinia';

const { allowance, usedPercent, tone, resetDate } = useAiAllowance();
const { canSeeBilling } = storeToRefs(useUserStore());

const NOTE_KEYS = {
  ok: 'aiUsage.meter.ok',
  warning: 'aiUsage.meter.warning',
  reached: 'aiUsage.meter.reached',
} as const;
</script>

<template>
  <section v-if="allowance" class="grid gap-2.5 rounded-lg border p-4" :aria-label="$t('aiUsage.title')">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h3 class="text-sm font-semibold">{{ $t('aiUsage.title') }}</h3>
      <span :class="cn('text-sm font-semibold tabular-nums', AI_ALLOWANCE_TEXT_CLASS[tone])">
        {{ $t('aiUsage.percentUsed', { percent: usedPercent }) }}
      </span>
    </div>

    <AiUsageBar :used-percent="usedPercent" :tone="tone" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p :class="cn('text-xs', tone === 'ok' ? 'text-muted-foreground' : AI_ALLOWANCE_TEXT_CLASS[tone])">
        {{ $t(NOTE_KEYS[allowance.state], { date: resetDate }) }}
      </p>

      <div v-if="allowance.state === 'reached'" class="flex flex-wrap gap-2">
        <Button v-if="allowance.plan === 'trial' && canSeeBilling" variant="soft-primary" size="sm" as-child>
          <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">{{ $t('billing.seePlans') }}</RouterLink>
        </Button>
        <Button :variant="allowance.plan === 'trial' ? 'ghost-primary' : 'soft-primary'" size="sm" as-child>
          <RouterLink :to="{ name: ROUTES_NAMES.settingsAiModels }">{{ $t('aiUsage.connectOwnModel') }}</RouterLink>
        </Button>
      </div>
    </div>
  </section>
</template>
