<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { storeToRefs } from 'pinia';

const { canSeeBilling, budgetTrial } = storeToRefs(useUserStore());
</script>

<template>
  <Callout v-if="canSeeBilling && budgetTrial" :variant="budgetTrial.state === 'active' ? 'primary' : 'warning'">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span v-if="budgetTrial.state === 'active'">
        {{ $t('budgetPlans.trialNotice.active', { count: budgetTrial.daysLeft }) }}
      </span>
      <span v-else>{{ $t('budgetPlans.trialNotice.ended') }} {{ $t('budgetPlans.trialNotice.offer') }}</span>
      <RouterLink :to="{ name: ROUTES_NAMES.settingsPlanBilling }">
        <Button variant="soft-primary" size="sm">{{ $t('billing.seePlans') }}</Button>
      </RouterLink>
    </div>
  </Callout>
</template>
