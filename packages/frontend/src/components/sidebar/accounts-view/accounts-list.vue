<script setup lang="ts">
import { AccountModel } from '@bt/shared/types';
import { computed } from 'vue';

import AccountItem from './accounts-item.vue';
import { useHideZeroBalances } from './helpers/use-hide-zero-balances';

const props = defineProps<{
  accounts: AccountModel[];
}>();

const { filterAccounts } = useHideZeroBalances();
const visibleAccounts = computed(() =>
  [...filterAccounts(props.accounts)].sort((a, b) => a.name.localeCompare(b.name)),
);
</script>

<template>
  <template v-for="account in visibleAccounts" :key="account.id">
    <AccountItem :account="account" />
  </template>
</template>
