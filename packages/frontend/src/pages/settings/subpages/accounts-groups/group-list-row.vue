<script setup lang="ts">
import GroupLogo from '@/components/common/group-logo.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { collectGroupAccounts } from '@/components/sidebar/accounts-view/helpers/account-totals';
import GroupTotal from '@/components/sidebar/accounts-view/group-total.vue';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { ChevronRightIcon, GripVerticalIcon, PencilIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AccountGroupListItem } from './build-account-group-list';
import GroupRowMenu, { type GroupRowAction } from './group-row/group-row-menu.vue';
import { AMOUNT_COLUMN_CLASS, HOVER_ACTIONS_CLASS } from './row-styles';

const props = defineProps<{
  item: AccountGroupListItem;
  depth: number;
  expanded: boolean;
  organizing: boolean;
  touch: boolean;
  dragDisabled?: boolean;
  moved?: boolean;
  dimmed?: boolean;
  dropTarget?: boolean;
}>();

const emit = defineEmits<{ toggle: []; action: [action: GroupRowAction] }>();

const { t } = useI18n();

const group = computed(() => props.item.group);
const isBankLinked = computed(() => !!group.value.bankDataProviderConnectionId);
const isExpandable = computed(() => props.item.children.length > 0 || group.value.accounts.length > 0);
// The whole subtree: a parent whose accounts all sit in subgroups still reads as populated.
const subtreeAccounts = computed(() => collectGroupAccounts({ group: group.value }));
const accountsCount = computed(() => subtreeAccounts.value.length);

const { baseCurrencyCode, sumBaseBalance } = useBaseBalanceTotals();
const total = computed(() => sumBaseBalance({ accounts: subtreeAccounts.value }));

const { accounts: allAccounts } = storeToRefs(useAccountsStore());

// A connection group the user emptied by regrouping its accounts still syncs them;
// plain "No accounts" reads like the connection lost them, so call out where they live.
const linkedAccountsElsewhereCount = computed(() => {
  if (!isBankLinked.value || accountsCount.value > 0) return 0;
  return (allAccounts.value ?? []).filter(
    (account) => account.bankDataProviderConnectionId === group.value.bankDataProviderConnectionId,
  ).length;
});

const countLabel = computed(() => {
  if (accountsCount.value > 0) {
    return t('settings.accountGroups.row.accountsCount', { count: accountsCount.value }, accountsCount.value);
  }
  return linkedAccountsElsewhereCount.value > 0
    ? t(
        'settings.accountGroups.row.accountsElsewhere',
        { count: linkedAccountsElsewhereCount.value },
        linkedAccountsElsewhereCount.value,
      )
    : t('settings.accountGroups.row.noAccounts');
});

const toggle = () => {
  if (!props.organizing && isExpandable.value) emit('toggle');
};
</script>

<template>
  <div
    :draggable="organizing && !dragDisabled"
    :class="
      cn(
        'group/row flex h-10 items-center pr-3 pl-2 transition-colors',
        organizing ? 'cursor-grab active:cursor-grabbing' : 'hover:bg-muted/40',
        !organizing && isExpandable && 'cursor-pointer',
        dimmed && 'cursor-not-allowed opacity-40',
        dropTarget && 'bg-primary/15 ring-primary ring-2 ring-inset',
      )
    "
    @click="toggle"
  >
    <GripVerticalIcon v-if="organizing" class="text-muted-foreground mr-1 size-4 shrink-0" aria-hidden="true" />

    <span v-for="level in depth" :key="level" class="flex w-4 shrink-0 justify-center self-stretch" aria-hidden="true">
      <span class="bg-border w-px" />
    </span>

    <Button
      v-if="isExpandable && !organizing"
      variant="ghost"
      size="icon-sm"
      class="size-4 shrink-0 rounded-sm"
      :aria-expanded="expanded"
      :aria-label="expanded ? $t('settings.accountGroups.tree.collapse') : $t('settings.accountGroups.tree.expand')"
      @click.stop="emit('toggle')"
    >
      <ChevronRightIcon
        :class="cn('text-muted-foreground size-4 transition-transform', expanded && 'rotate-90')"
        aria-hidden="true"
      />
    </Button>
    <span v-else class="w-4 shrink-0" aria-hidden="true" />

    <div class="ml-2 flex min-w-0 flex-1 items-center gap-2">
      <GroupLogo :group="group" size="size-5" rounded="md" variant="tile" />

      <span class="truncate font-semibold">{{ group.name }}</span>

      <DesktopOnlyTooltip
        v-if="isBankLinked"
        :content="$t('settings.accountGroups.row.bankBadgeTooltip')"
        content-class-name="max-w-80"
      >
        <span class="border-border text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-xs">
          {{ $t('settings.accountGroups.tree.syncedBadge') }}
        </span>
      </DesktopOnlyTooltip>

      <template v-if="organizing">
        <span v-if="dropTarget" class="text-primary-text shrink-0 text-xs font-medium">
          {{ $t('settings.accountGroups.organize.moveInside') }}
        </span>
        <span v-else-if="moved" class="text-primary-text shrink-0 text-xs">
          {{ $t('settings.accountGroups.organize.moved') }}
        </span>
      </template>

      <span v-else-if="!touch" :class="HOVER_ACTIONS_CLASS">
        <DesktopOnlyTooltip :content="$t('settings.accountGroups.tree.renameTooltip')">
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-7"
            :aria-label="$t('settings.accountGroups.tree.renameTooltip')"
            @click.stop="emit('action', 'rename')"
          >
            <PencilIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>

        <GroupRowMenu :group="group" align="start" @action="emit('action', $event)" />
      </span>
    </div>

    <span class="text-muted-foreground ml-3 hidden shrink-0 text-sm @md/account-groups:inline">{{ countLabel }}</span>

    <div v-if="!organizing && baseCurrencyCode" :class="AMOUNT_COLUMN_CLASS">
      <GroupTotal :amount="total.total" :currency-code="baseCurrencyCode" :is-approx="total.isApprox" show-zero />
    </div>

    <span v-if="touch && !organizing" class="ml-1 shrink-0">
      <GroupRowMenu :group="group" align="end" @action="emit('action', $event)" />
    </span>
  </div>
</template>
