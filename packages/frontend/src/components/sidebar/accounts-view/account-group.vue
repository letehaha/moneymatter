<script setup lang="ts">
import type { AccountGroups } from '@/common/types/models';
import AccountGroupName from '@/components/common/account-group-name.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { useSyncStatus } from '@/composable/use-sync-status';
import { AlertTriangleIcon, ChevronRightIcon } from '@lucide/vue';
import { computed, inject } from 'vue';

import AccountGroupsList from './account-groups-list.vue';
import AccountsList from './accounts-list.vue';
import GroupTotal from './group-total.vue';
import { collectGroupAccounts } from './helpers/account-totals';
import { useActiveAccountGroups } from './helpers/use-active-account-groups';

const props = defineProps<{
  group: AccountGroups;
}>();

const accountGroupsContext = inject<ReturnType<typeof useActiveAccountGroups>>('accountGroupsContext');

const isOpen = computed({
  get: () => accountGroupsContext!.isGroupOpen(props.group.id),
  set: (val) => accountGroupsContext!.setGroupOpen(props.group.id, val),
});

const { groupHasReauthAccount } = useSyncStatus();

const needsReauth = computed(() => groupHasReauthAccount(props.group));

const { baseCurrencyCode, sumBaseBalance } = useBaseBalanceTotals();

// The whole subtree rolls up here: direct accounts plus every nested child group,
// so a collapsed bank shows its full worth without expanding.
const groupTotal = computed(() => sumBaseBalance({ accounts: collectGroupAccounts({ group: props.group }) }));
</script>

<template>
  <Collapsible v-model:open="isOpen">
    <CollapsibleTrigger class="w-full">
      <Button variant="ghost" as="div" size="default" class="w-full px-2">
        <div class="flex w-full items-center gap-2">
          <ChevronRightIcon :class="['size-4 shrink-0 transition-transform duration-200', { 'rotate-90': isOpen }]" />
          <AccountGroupName :group="group" class="min-w-0 text-sm" />
          <ResponsiveTooltip
            v-if="needsReauth"
            :content="$t('sidebar.accountsView.needsReauthTooltip')"
            content-class-name="max-w-64"
          >
            <AlertTriangleIcon class="text-destructive-text size-4 shrink-0" />
          </ResponsiveTooltip>
          <span class="ml-auto shrink-0">
            <!-- Collapsed row is a summary (show the roll-up); expanded row is detail, so its
                 own accounts carry the numbers and repeating the total here would just be noise. -->
            <GroupTotal
              v-if="!isOpen && baseCurrencyCode"
              tiny
              :amount="groupTotal.total"
              :currency-code="baseCurrencyCode"
              :is-approx="groupTotal.isApprox"
            />
          </span>
        </div>
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="border-border/40 ml-2 border-l pl-2">
        <AccountsList :accounts="group.accounts" />
        <AccountGroupsList v-if="group.childGroups.length" :groups="group.childGroups" />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
