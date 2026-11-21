<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import {
  type LinkedAccountMapping,
  getBankSeamSkippedMessage,
  getLinkedAccounts,
} from '@/pages/import-export/utils/bank-seam-targets';
import { useAccountsStore } from '@/stores/accounts';
import type { AccountModel } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  count: number | undefined;
  accounts?: (AccountModel | null | undefined)[];
  accountMapping?: LinkedAccountMapping;
}>();
const { t } = useI18n();
const accountsStore = useAccountsStore();

const targetAccounts = computed(
  () =>
    props.accounts ??
    getLinkedAccounts({ accountMapping: props.accountMapping ?? {}, accountsRecord: accountsStore.accountsRecord }),
);
</script>

<template>
  <Callout v-if="count" variant="warning">
    <p>{{ getBankSeamSkippedMessage({ count, accounts: targetAccounts, t }) }}</p>
  </Callout>
</template>
