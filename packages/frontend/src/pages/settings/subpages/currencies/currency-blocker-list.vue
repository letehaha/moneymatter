<template>
  <ul class="grid gap-1 text-sm" data-testid="currency-blocker-list">
    <li v-for="group in blockerGroups" :key="group.type">
      <span class="font-medium">{{ group.label }}:</span> {{ group.names }}
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { CurrencyInUseBlocker } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ blockers: CurrencyInUseBlocker[] }>();

const { t } = useI18n();

const BLOCKER_LABEL_KEYS: Record<CurrencyInUseBlocker['type'], string> = {
  account: 'settings.currencies.delete.inUse.types.account',
  portfolio: 'settings.currencies.delete.inUse.types.portfolio',
  holding: 'settings.currencies.delete.inUse.types.holding',
  portfolioCash: 'settings.currencies.delete.inUse.types.portfolioCash',
  portfolioTransfer: 'settings.currencies.delete.inUse.types.portfolioTransfer',
  investmentTransaction: 'settings.currencies.delete.inUse.types.investmentTransaction',
  subscription: 'settings.currencies.delete.inUse.types.subscription',
  transactionTemplate: 'settings.currencies.delete.inUse.types.transactionTemplate',
  budget: 'settings.currencies.delete.inUse.types.budget',
  goal: 'settings.currencies.delete.inUse.types.goal',
  ventureDeal: 'settings.currencies.delete.inUse.types.ventureDeal',
  customCurrency: 'settings.currencies.delete.inUse.types.customCurrency',
};

const blockerGroups = computed(() => {
  const namesByType = new Map<CurrencyInUseBlocker['type'], string[]>();
  for (const blocker of props.blockers) {
    const name = blocker.trashed ? `${blocker.name} ${t('settings.currencies.delete.inUse.trashed')}` : blocker.name;
    namesByType.set(blocker.type, [...(namesByType.get(blocker.type) ?? []), name]);
  }
  return [...namesByType].map(([type, names]) => ({
    type,
    label: t(BLOCKER_LABEL_KEYS[type]),
    names: names.join(', '),
  }));
});
</script>
