<script setup lang="ts">
import type { AccountGroups } from '@/common/types/models';
import { computed } from 'vue';

import AccountGroup from './account-group.vue';
import { groupHasAccounts } from './helpers/account-totals';
import { useHideZeroBalances } from './helpers/use-hide-zero-balances';

const props = defineProps<{
  groups: AccountGroups[];
}>();

const { isGroupVisible } = useHideZeroBalances();

const sortedGroups = computed(() => [...props.groups].sort((a, b) => a.name.localeCompare(b.name)));
</script>

<template>
  <template v-for="group in sortedGroups" :key="group.id">
    <AccountGroup v-if="groupHasAccounts({ group }) && isGroupVisible(group)" :group="group" />
  </template>
</template>
