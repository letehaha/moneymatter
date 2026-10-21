<script setup lang="ts">
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { FEATURES } from '@bt/shared/types';
import { SparklesIcon } from '@lucide/vue';

import { useGoalsAccess } from '../composables/use-goals-access';

const userStore = useUserStore();
const { isPlanGated, hasTrialRecord, isTrialAvailable, trialDaysLeft, isStartingTrial, startTrial } = useGoalsAccess();
</script>

<template>
  <Callout v-if="trialDaysLeft !== null" variant="info">
    {{ $t('goals.access.trialDaysLeft', trialDaysLeft) }}
    <Button v-if="userStore.canSeeBilling" as-child variant="link" size="sm" class="h-auto p-0">
      <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">{{ $t('billing.seePlans') }}</RouterLink>
    </Button>
  </Callout>

  <Callout v-else-if="isTrialAvailable" variant="info" :icon="SparklesIcon" :title="$t('goals.access.trialTitle')">
    <p class="text-muted-foreground text-sm">{{ $t('goals.access.trialDescription') }}</p>
    <Button size="sm" variant="soft-primary" class="mt-3" :disabled="isStartingTrial" @click="startTrial">
      {{ $t('goals.access.startTrial') }}
    </Button>
  </Callout>

  <PlanRestricted
    v-else-if="isPlanGated"
    :feature="FEATURES.goals"
    :hint="hasTrialRecord ? $t('goals.access.trialEnded') : undefined"
  />
</template>
