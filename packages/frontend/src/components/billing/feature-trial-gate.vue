<script setup lang="ts">
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useFeatureTrialAccess } from '@/composable/use-ai-feature-access';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import type { Feature } from '@bt/shared/types';
import { SparklesIcon } from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';

const props = defineProps<{
  feature: Feature;
  /** What the feature gives, shown on the trial and upgrade cards. */
  description?: string;
}>();

defineSlots<{
  default: () => unknown;
  /** Blurred stand-in shown behind the trial/upgrade card; the real content never mounts while locked. */
  preview?: () => unknown;
}>();

const userStore = useUserStore();
const { isPlanGated, hasTrialRecord, isTrialAvailable, trialDaysLeft, trialDays, isStartingTrial, startTrial } =
  useFeatureTrialAccess({ feature: props.feature });

const [DefineSkeleton, ReuseSkeleton] = createReusableTemplate();
</script>

<template>
  <DefineSkeleton>
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-3 @md/gate:grid-cols-4">
        <div v-for="i in 4" :key="i" class="bg-muted h-20 rounded-lg" />
      </div>
      <div class="bg-muted h-64 rounded-lg" />
    </div>
  </DefineSkeleton>

  <div v-if="!isPlanGated" class="flex flex-col gap-4">
    <Callout v-if="trialDaysLeft !== null" variant="info">
      {{ $t('billing.featureTrialGate.daysLeft', trialDaysLeft) }}
      <Button v-if="userStore.canSeeBilling" as-child variant="link" size="sm" class="h-auto p-0">
        <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">{{ $t('billing.seePlans') }}</RouterLink>
      </Button>
    </Callout>
    <slot />
  </div>

  <div v-else-if="isTrialAvailable" class="@container/gate relative min-h-80">
    <div inert class="pointer-events-none opacity-40 blur-[2px] select-none">
      <slot name="preview">
        <ReuseSkeleton />
      </slot>
    </div>
    <div class="absolute inset-0 flex items-start justify-center p-4 pt-16">
      <div class="bg-card flex max-w-sm flex-col items-center gap-2 rounded-lg border p-5 text-center shadow-lg">
        <SparklesIcon class="text-primary-text size-6" />
        <p class="font-medium">{{ $t('billing.featureTrialGate.title', { days: trialDays }) }}</p>
        <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
        <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" :disabled="isStartingTrial" @click="startTrial">
            {{ $t('billing.featureTrialGate.startTrial', { days: trialDays }) }}
          </Button>
          <Button v-if="userStore.canSeeBilling" as-child variant="outline" size="sm">
            <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">{{ $t('billing.seePlans') }}</RouterLink>
          </Button>
        </div>
      </div>
    </div>
  </div>

  <PlanRestricted
    v-else
    :feature="feature"
    overlay
    :hint="hasTrialRecord ? $t('billing.featureTrialGate.trialEnded') : description"
  >
    <slot name="preview">
      <div class="@container/gate min-h-80">
        <ReuseSkeleton />
      </div>
    </slot>
  </PlanRestricted>
</template>
