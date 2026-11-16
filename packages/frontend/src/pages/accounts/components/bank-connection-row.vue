<template>
  <Collapsible v-model:open="isOpen">
    <div class="hover:bg-hover flex items-center gap-3 px-4 py-3 transition-colors">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <CollapsibleTrigger
          class="focus-visible:ring-ring/40 flex min-w-0 cursor-pointer items-center gap-3 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronRightIcon
            class="text-muted-foreground size-4 shrink-0 transition-transform"
            :class="{ 'rotate-90': isOpen }"
            aria-hidden="true"
          />

          <BankConnectionLogo :connection-id="connection.id" size="size-7">
            <template #fallback>
              <LandmarkIcon class="text-muted-foreground size-7 shrink-0" />
            </template>
          </BankConnectionLogo>

          <span class="min-w-0 truncate text-sm font-semibold">{{ connectionName }}</span>
        </CollapsibleTrigger>

        <AccountConnectionStatusBadge :connection-id="connection.id" :kind="connectionStatus" />
      </div>

      <div class="flex items-center gap-3">
        <DesktopOnlyTooltip :content="$t('accounts.manageConnection')">
          <UiButton variant="ghost" size="icon-sm" @click="goToConnection">
            <Settings2Icon class="size-4" />
          </UiButton>
        </DesktopOnlyTooltip>

        <span class="text-muted-foreground hidden shrink-0 text-xs tabular-nums @[30rem]/accounts-page:inline">
          {{ $t('accounts.accountsCount', { count: accounts.length }) }}
        </span>

        <GroupTotal
          v-if="baseCurrencyCode"
          :amount="connectionTotal.total"
          :currency-code="baseCurrencyCode"
          :is-approx="connectionTotal.isApprox"
          show-zero
        />
      </div>
    </div>

    <CollapsibleContent>
      <div class="border-border/40 ml-4 border-l pl-2">
        <AccountListRow
          v-for="account in sortedAccounts"
          :key="account.id"
          :account="account"
          :subtitle="accountSubtitle(account)"
        />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import type { BankConnection } from '@/api/bank-data-providers';
import BankConnectionLogo from '@/components/common/bank-connection-logo.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import GroupTotal from '@/components/sidebar/accounts-view/group-total.vue';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { useSyncStatus } from '@/composable/use-sync-status';
import { goToConnectionDetails } from '@/routes/navigation';
import type { AccountModel } from '@bt/shared/types';
import { ChevronRightIcon, LandmarkIcon, Settings2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { type ConnectionStatusKind, deriveConnectionStatus } from '../connection-status';
import { useAccountsSort } from '../use-accounts-sort';
import AccountConnectionStatusBadge from './account-connection-status-badge.vue';
import AccountListRow from './account-list-row.vue';
import { useAccountsPageGroups } from './use-accounts-page-groups';

const props = defineProps<{
  connection: BankConnection;
  accounts: AccountModel[];
  /** Account id → folder-group name, for the "in <group>" subtitle on account rows. */
  folderGroupNames: Record<string, string>;
}>();

const { t } = useI18n();
const router = useRouter();

const connectionName = computed(() => props.connection.providerName || props.connection.bankName || '');

const { sortLeafAccounts } = useAccountsSort();
const sortedAccounts = computed(() => sortLeafAccounts(props.accounts));

// Connection id doubles as the persisted open-state key; ids never collide with group ids.
const { isGroupOpen, setGroupOpen } = useAccountsPageGroups();
const isOpen = computed({
  get: () => isGroupOpen(props.connection.id),
  set: (val) => setGroupOpen(props.connection.id, val),
});

const { getConnectionStatus, isConnectionNeedingReauth } = useSyncStatus();
const connectionStatus = computed<ConnectionStatusKind>(() =>
  deriveConnectionStatus({
    summary: getConnectionStatus(props.connection.id),
    needsReauth: isConnectionNeedingReauth(props.connection.id),
  }),
);

const { baseCurrencyCode, sumBaseBalance } = useBaseBalanceTotals();
const connectionTotal = computed(() => sumBaseBalance({ accounts: props.accounts }));

const accountSubtitle = (account: AccountModel): string | undefined => {
  const groupName = props.folderGroupNames[account.id];
  return groupName ? t('accounts.inGroupSubtitle', { name: groupName }) : undefined;
};

const goToConnection = () => goToConnectionDetails({ router, connectionId: props.connection.id });
</script>
