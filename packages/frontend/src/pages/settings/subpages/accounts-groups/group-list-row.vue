<script setup lang="ts">
import GroupLogo from '@/components/common/group-logo.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { collectGroupAccounts } from '@/components/sidebar/accounts-view/helpers/account-totals';
import GroupTotal from '@/components/sidebar/accounts-view/group-total.vue';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { cn } from '@/lib/utils';
import { goToConnectionDetails } from '@/routes/navigation';
import { useAccountsStore } from '@/stores';
import { ChevronDownIcon, Settings2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import type { AccountGroupListItem } from './build-account-group-list';
import DeleteGroup from './group-row/delete-group.vue';
import EditGroupForm from './group-row/edit-group-form.vue';
import GroupAccountRow from './group-row/group-account-row.vue';

const props = defineProps<{ item: AccountGroupListItem; expandedGroupId: string | null }>();

const emit = defineEmits<{ toggle: [id: string] }>();

const { t } = useI18n();
const router = useRouter();

const group = computed(() => props.item.group);
const isBankLinked = computed(() => !!group.value.bankDataProviderConnectionId);
// Single-open accordion shared by the whole tree: this row's panel is open when it holds the id.
const expanded = computed(() => props.expandedGroupId === group.value.id);
const ownAccountsCount = computed(() => group.value.accounts.length);
// The whole subtree: a parent whose accounts all sit in subgroups still reads as populated.
const subtreeAccounts = computed(() => collectGroupAccounts({ group: group.value }));
const accountsCount = computed(() => subtreeAccounts.value.length);

const { baseCurrencyCode, sumBaseBalance } = useBaseBalanceTotals();

// A parent's total rolls up its subgroups, so it matches what the nested rows add up to.
const total = computed(() => sumBaseBalance({ accounts: subtreeAccounts.value }));

const { accounts: allAccounts } = storeToRefs(useAccountsStore());

// A connection group the user emptied by regrouping its accounts still syncs them —
// plain "No accounts" reads like the connection lost them, so call out where they live.
const linkedAccountsElsewhereCount = computed(() => {
  if (!isBankLinked.value || accountsCount.value > 0) return 0;
  return (allAccounts.value ?? []).filter(
    (account) => account.bankDataProviderConnectionId === group.value.bankDataProviderConnectionId,
  ).length;
});

const subtitle = computed(() => {
  const emptyLabel =
    linkedAccountsElsewhereCount.value > 0
      ? t(
          'settings.accountGroups.row.accountsElsewhere',
          { count: linkedAccountsElsewhereCount.value },
          linkedAccountsElsewhereCount.value,
        )
      : t('settings.accountGroups.row.noAccounts');

  return accountsCount.value > 0
    ? t('settings.accountGroups.row.accountsCount', { count: accountsCount.value }, accountsCount.value)
    : emptyLabel;
});
</script>

<template>
  <div>
    <button
      type="button"
      :aria-expanded="expanded"
      :class="
        cn(
          'grid w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 px-4 py-3 text-left',
          'hover:bg-muted/40 focus-visible:ring-ring/40 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none',
        )
      "
      @click="emit('toggle', group.id)"
    >
      <div class="flex min-w-0 items-center gap-3">
        <GroupLogo :group="group" size="size-9" variant="tile" />

        <div class="min-w-0">
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <span class="truncate text-sm font-semibold">{{ group.name }}</span>

            <DesktopOnlyTooltip
              v-if="isBankLinked"
              :content="$t('settings.accountGroups.row.bankBadgeTooltip')"
              content-class-name="max-w-80"
            >
              <span class="bg-primary/15 text-primary-text shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                <span class="hidden @[30rem]/account-groups:inline">
                  {{ $t('settings.accountGroups.row.bankBadge') }}
                </span>
                <span class="@[30rem]/account-groups:hidden">
                  {{ $t('settings.accountGroups.row.bankBadgeShort') }}
                </span>
              </span>
            </DesktopOnlyTooltip>
          </div>

          <div class="text-muted-foreground mt-0.5 truncate text-xs">{{ subtitle }}</div>
        </div>
      </div>

      <GroupTotal
        v-if="baseCurrencyCode"
        :amount="total.total"
        :currency-code="baseCurrencyCode"
        :is-approx="total.isApprox"
        show-zero
      />

      <ChevronDownIcon
        class="text-muted-foreground size-3.5 transition-transform"
        :class="{ 'rotate-180': expanded }"
        aria-hidden="true"
      />
    </button>

    <div v-if="expanded" class="border-border/60 bg-muted/20 border-t px-4 py-4">
      <EditGroupForm :group="group" />

      <div class="bg-border/60 my-4 h-px w-full" />

      <h4 class="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        {{ $t('settings.accountGroups.accounts.heading') }}
      </h4>

      <div
        v-if="ownAccountsCount"
        class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-lg border"
      >
        <GroupAccountRow v-for="account in group.accounts" :key="account.id" :account="account" :group-id="group.id" />
      </div>
      <p v-else class="text-muted-foreground text-sm">
        {{
          linkedAccountsElsewhereCount > 0
            ? $t('settings.accountGroups.accounts.emptyBankLinked')
            : $t('settings.accountGroups.accounts.empty')
        }}
      </p>

      <div class="mt-4 flex flex-wrap items-center justify-end gap-3">
        <Button
          v-if="isBankLinked"
          variant="outline"
          size="sm"
          class="mr-auto"
          @click="goToConnectionDetails({ router, connectionId: group.bankDataProviderConnectionId })"
        >
          <Settings2Icon class="size-4" />
          {{ $t('settings.accountGroups.row.manageConnection') }}
        </Button>

        <DeleteGroup :group="group" />
      </div>
    </div>

    <!-- Subgroups nest under their parent; each is a full row, so edit and delete work the same. -->
    <div
      v-if="item.children.length"
      class="border-border/60 divide-border/60 ml-4 divide-y border-t border-l"
      role="group"
      :aria-label="group.name"
    >
      <GroupListRow
        v-for="child in item.children"
        :key="child.group.id"
        :item="child"
        :expanded-group-id="expandedGroupId"
        @toggle="emit('toggle', $event)"
      />
    </div>
  </div>
</template>
