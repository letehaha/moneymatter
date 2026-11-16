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

          <AccountGroupName :group="group" icon-size="size-7" icon-rounded="lg" class="min-w-0 text-sm font-semibold" />
        </CollapsibleTrigger>

        <AccountConnectionStatusBadge
          v-if="group.bankDataProviderConnectionId"
          :connection-id="group.bankDataProviderConnectionId"
          :kind="connectionStatus"
        />
        <AccountConnectionStatusBadge v-else-if="needsReauth" kind="reauth" />
      </div>

      <div class="flex items-center gap-3">
        <DesktopOnlyTooltip v-if="group.bankDataProviderConnectionId" :content="$t('accounts.manageConnection')">
          <UiButton variant="ghost" size="icon-sm" @click="goToConnection">
            <Settings2Icon class="size-4" />
          </UiButton>
        </DesktopOnlyTooltip>

        <span class="text-muted-foreground hidden shrink-0 text-xs tabular-nums @[30rem]/accounts-page:inline">
          {{ $t('accounts.accountsCount', { count: accountCount }) }}
        </span>

        <GroupTotal
          v-if="baseCurrencyCode"
          :amount="groupTotal.total"
          :currency-code="baseCurrencyCode"
          :is-approx="groupTotal.isApprox"
          show-zero
        />
      </div>
    </div>

    <CollapsibleContent>
      <div class="border-border/40 ml-4 border-l pl-2">
        <template v-for="item in sortedChildren" :key="item.id">
          <AccountListRow v-if="item.kind === 'account'" :account="item.account" />
          <AccountGroupRow v-else :group="item.group" />
        </template>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import type { AccountGroups } from '@/common/types/models';
import AccountGroupName from '@/components/common/account-group-name.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import GroupTotal from '@/components/sidebar/accounts-view/group-total.vue';
import { collectGroupAccounts } from '@/components/sidebar/accounts-view/helpers/account-totals';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { useSyncStatus } from '@/composable/use-sync-status';
import { goToConnectionDetails } from '@/routes/navigation';
import { ChevronRightIcon, Settings2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { type ConnectionStatusKind, deriveConnectionStatus } from '../connection-status';
import { useAccountsSort } from '../use-accounts-sort';
import AccountConnectionStatusBadge from './account-connection-status-badge.vue';
import AccountListRow from './account-list-row.vue';
import { useAccountsPageGroups } from './use-accounts-page-groups';

defineOptions({ name: 'AccountGroupRow' });

const props = defineProps<{ group: AccountGroups }>();

const { sortGroupChildren } = useAccountsSort();
const sortedChildren = computed(() => sortGroupChildren(props.group));

const router = useRouter();
const { isGroupOpen, setGroupOpen } = useAccountsPageGroups();

const isOpen = computed({
  get: () => isGroupOpen(props.group.id),
  set: (val) => setGroupOpen(props.group.id, val),
});

const { groupHasReauthAccount, getConnectionStatus, isConnectionNeedingReauth } = useSyncStatus();
const needsReauth = computed(() => groupHasReauthAccount(props.group));

// Only meaningful for connection groups (bankDataProviderConnectionId set); for
// folder groups the badge is never rendered, so the 'active' fallback is unused.
const connectionStatus = computed<ConnectionStatusKind>(() =>
  deriveConnectionStatus({
    summary: getConnectionStatus(props.group.bankDataProviderConnectionId),
    needsReauth: isConnectionNeedingReauth(props.group.bankDataProviderConnectionId),
  }),
);

const { baseCurrencyCode, sumBaseBalance } = useBaseBalanceTotals();

const groupAccounts = computed(() => collectGroupAccounts({ group: props.group }));
const accountCount = computed(() => groupAccounts.value.length);

// The whole subtree rolls up here: direct accounts plus every nested child group,
// so a collapsed connection shows its full worth without expanding.
const groupTotal = computed(() => sumBaseBalance({ accounts: groupAccounts.value }));

const goToConnection = () => goToConnectionDetails({ router, connectionId: props.group.bankDataProviderConnectionId });
</script>
