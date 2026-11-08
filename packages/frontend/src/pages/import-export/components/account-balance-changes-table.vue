<script setup lang="ts">
/**
 * Per-account balance-change summary rendered on both importers' done steps.
 * One row per touched account: balance before/after, the signed delta, and how
 * many imported rows moved the balance ("new" rows) vs. landed as backfill
 * (older than the account's latest pre-import transaction, absorbed into the
 * opening balance). Accounts created by the import show their final balance
 * only — there is no meaningful "before".
 *
 * Amounts are decimals in the account's own currency. The currency code is
 * looked up from the accounts store (the import flow refetches accounts on
 * completion, so freshly created accounts resolve too); when the account can't
 * be resolved the bare number is shown rather than a wrong currency symbol.
 *
 * MappingTable collapses to stacked cards on narrow containers, so the table
 * never forces horizontal page scroll.
 */
import { MappingTable, type MappingTableColumn } from '@/components/lib/ui/mapping-table';
import { useFormatCurrency } from '@/composable/formatters';
import { toLocalNumber } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores/accounts';
import type { AccountBalanceChange } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{ changes: AccountBalanceChange[] }>();

const { accountsRecord } = storeToRefs(useAccountsStore());
const { formatAmountByCurrencyCode } = useFormatCurrency();

/**
 * Rows for accounts that existed before the import — the only
 * `AccountBalanceChange` variant carrying `balanceBefore`/`delta` (created
 * accounts have no meaningful "before"). The template's `isNewAccount` branches
 * narrow to this before the Before/Delta helpers run.
 */
type ExistingAccountChange = Extract<AccountBalanceChange, { isNewAccount: false }>;

function formatAmount({ change, amount }: { change: AccountBalanceChange; amount: number }): string {
  const account = accountsRecord.value[change.accountId];
  if (account) return formatAmountByCurrencyCode(amount, account.currencyCode);
  return toLocalNumber(amount, { maximumFractionDigits: 2 });
}

function formatDelta(change: ExistingAccountChange): string {
  const formatted = formatAmount({ change, amount: change.delta });
  return change.delta > 0 ? `+${formatted}` : formatted;
}

function deltaClass(change: ExistingAccountChange): string {
  if (change.delta > 0) return 'text-app-income-color';
  if (change.delta < 0) return 'text-app-expense-color';
  return 'text-muted-foreground';
}

const columns = computed<MappingTableColumn[]>(() => [
  {
    key: 'account',
    label: t('importShared.balanceChanges.columns.account'),
    width: 'minmax(0,1.4fr)',
    cardHeader: true,
  },
  {
    key: 'before',
    label: t('importShared.balanceChanges.columns.before'),
    width: 'minmax(0,1fr)',
    align: 'end',
    cardValue: 'inline',
  },
  {
    key: 'after',
    label: t('importShared.balanceChanges.columns.after'),
    width: 'minmax(0,1fr)',
    align: 'end',
    cardValue: 'inline',
  },
  {
    key: 'delta',
    label: t('importShared.balanceChanges.columns.delta'),
    width: 'minmax(0,1fr)',
    align: 'end',
    cardValue: 'inline',
  },
  {
    key: 'moved',
    label: t('importShared.balanceChanges.columns.newRows'),
    width: '90px',
    align: 'end',
    cardValue: 'inline',
  },
  {
    key: 'backfilled',
    label: t('importShared.balanceChanges.columns.backfillRows'),
    width: '90px',
    align: 'end',
    cardValue: 'inline',
  },
]);
</script>

<template>
  <section v-if="changes.length > 0" aria-labelledby="balance-changes-heading">
    <h3 id="balance-changes-heading" class="mb-3 text-sm font-semibold">
      {{ $t('importShared.balanceChanges.title') }}
    </h3>

    <MappingTable :columns="columns" :items="changes" :row-key="(change) => change.accountId">
      <template #cell:account="{ item }">
        <span class="truncate font-medium">{{ item.accountName }}</span>
      </template>

      <template #cell:before="{ item }">
        <span v-if="item.isNewAccount" class="text-muted-foreground text-xs">
          {{ $t('importShared.balanceChanges.newAccount') }}
        </span>
        <span v-else class="text-sm tabular-nums">
          {{ formatAmount({ change: item, amount: item.balanceBefore }) }}
        </span>
      </template>

      <template #cell:after="{ item }">
        <span class="text-sm tabular-nums">{{ formatAmount({ change: item, amount: item.balanceAfter }) }}</span>
      </template>

      <template #cell:delta="{ item }">
        <span v-if="item.isNewAccount" class="text-muted-foreground text-sm">—</span>
        <span v-else :class="cn('text-sm tabular-nums', deltaClass(item))">{{ formatDelta(item) }}</span>
      </template>

      <template #cell:moved="{ item }">
        <span class="text-sm tabular-nums">{{ item.movedCount }}</span>
      </template>

      <template #cell:backfilled="{ item }">
        <span class="text-sm tabular-nums">{{ item.historicalCount }}</span>
      </template>
    </MappingTable>
  </section>
</template>
