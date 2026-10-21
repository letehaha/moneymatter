<script setup lang="ts">
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const';
import AccountLogo from '@/components/common/account-logo.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { Label } from '@/components/lib/ui/label';
import { useFormatCurrency } from '@/composable';
import { useGoals } from '@/composable/data-queries/goals';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { FULL_SHARE, accountGoalValue, roundShare } from '@bt/shared/goals/goal-math';
import { ACCOUNT_STATUSES, type AccountModel, type GoalAccountShare, type RecordId } from '@bt/shared/types';
import { SearchIcon, WalletIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { getShareError, isGoalEligibleAccount, parseNumberOrNull } from '../form-helpers';
import { MARKET_CATEGORIES, getAccountShareCapacity } from '../helpers';

const props = defineProps<{ goalName: string; modelValue: GoalAccountShare[]; editingGoalId?: RecordId }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ 'update:modelValue': [shares: GoalAccountShare[]] }>();

const { t } = useI18n();
const { formatAmountByCurrencyCode, formatBaseCurrency } = useFormatCurrency();
const { accounts, accountsRecord, isAccountsFetched } = storeToRefs(useAccountsStore());
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const { data: goals, isLoading: isGoalsLoading, refetch: refetchGoals } = useGoals();

const isLoading = computed(() => isGoalsLoading.value || !isAccountsFetched.value);
const isReady = computed(() => !isLoading.value && !!goals.value);

/** Ticked accounts and their typed share; a key present means checked. */
const draft = ref<Record<string, number | null>>({});
const search = ref('');

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    draft.value = Object.fromEntries(props.modelValue.map((share) => [share.accountId, share.sharePercent]));
    search.value = '';
  },
  { immediate: true },
);

const editingGoal = computed(() => (goals.value ?? []).find((goal) => goal.id === props.editingGoalId));

interface AccountRow {
  account: AccountModel;
  max: number;
  holders: string;
}

const rows = computed<AccountRow[]>(() => {
  const linkedAccountIds = props.modelValue.map((share) => share.accountId);
  const rank = (row: AccountRow) => {
    if (linkedAccountIds.includes(row.account.id)) return 0;
    return row.max > 0 ? 1 : 2;
  };

  return (accounts.value ?? [])
    .filter((account) => isGoalEligibleAccount({ account, linkedAccountIds }))
    .map((account) => {
      const { max, holders } = getAccountShareCapacity({
        goals: goals.value ?? [],
        accountId: account.id,
        editingGoal: editingGoal.value,
      });
      return {
        account,
        max,
        holders: holders
          .map(({ name, sharePercent }) => t('goals.accountsDialog.holder', { name, share: sharePercent }))
          .join(', '),
      };
    })
    .sort((a, b) => rank(a) - rank(b));
});

const visibleRows = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? rows.value.filter(({ account }) => account.name.toLowerCase().includes(query)) : rows.value;
});

/** Linked shares whose account is gone or no longer eligible; kept as they are unless unticked. */
const unavailableShares = computed(() =>
  props.modelValue.filter((share) => !rows.value.some(({ account }) => account.id === share.accountId)),
);
const keptUnavailableShares = computed(() => unavailableShares.value.filter((share) => share.accountId in draft.value));

const isChecked = ({ account }: { account: AccountModel }) => account.id in draft.value;

const setChecked = ({ accountId, share, checked }: { accountId: RecordId; share: number; checked: boolean }) => {
  const next = { ...draft.value };
  if (checked) next[accountId] = share;
  else delete next[accountId];
  draft.value = next;
};

const shareErrorOf = (row: AccountRow) =>
  isChecked(row) ? getShareError({ sharePercent: draft.value[row.account.id] ?? null, max: row.max }) : null;

const errorText = (row: AccountRow) => {
  const error = shareErrorOf(row);
  if (error === 'invalid') return t('goals.accountsDialog.errors.invalid');
  if (error === 'overMax') {
    return row.holders
      ? t('goals.accountsDialog.errors.overMaxUsedBy', { max: row.max, holders: row.holders })
      : t('goals.accountsDialog.errors.overMax', { max: row.max });
  }
  return undefined;
};

const countedOf = ({ account, max }: AccountRow) =>
  accountGoalValue({
    balance: account.refCurrentBalance,
    creditLimit: account.refCreditLimit,
    sharePercent: Math.min(draft.value[account.id] ?? 0, max),
  });

const shareHint = (row: AccountRow) => {
  const amount = formatBaseCurrency(countedOf(row));
  if (draft.value[row.account.id] === FULL_SHARE) return t('goals.accountsDialog.wholeAccount', { amount });
  if (row.max < FULL_SHARE) return t('goals.accountsDialog.maxShare', { max: row.max, amount });
  return t('goals.accountsDialog.counts', { amount });
};

const caption = (row: AccountRow) => {
  const { account } = row;
  const parts = [t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[account.accountCategory])];
  if (account.currencyCode !== baseCurrency.value?.currencyCode) parts.push(account.currencyCode);
  if (account.status === ACCOUNT_STATUSES.archived) parts.push(t('goals.accountsDialog.archived'));
  if (!isChecked(row) && row.max <= 0) parts.push(t('goals.accountsDialog.fullyUsed', { holders: row.holders }));
  else if (!isChecked(row) && row.max < FULL_SHARE) parts.push(t('goals.accountsDialog.free', { free: row.max }));
  return parts.join(' · ');
};

const checkedRows = computed(() => rows.value.filter(isChecked));
const invalidRow = computed(() => checkedRows.value.find((row) => shareErrorOf(row) !== null));
const total = computed(() => checkedRows.value.reduce((sum, row) => sum + countedOf(row), 0));
const hasMarketAccount = computed(() =>
  checkedRows.value.some(({ account }) => MARKET_CATEGORIES.includes(account.accountCategory)),
);

const setShare = ({ row, value }: { row: AccountRow; value: string | number | null }) => {
  draft.value = { ...draft.value, [row.account.id]: parseNumberOrNull(value) };
};

const selectedCount = computed(() => checkedRows.value.length + keptUnavailableShares.value.length);

const apply = () => {
  if (!isReady.value || invalidRow.value) return;
  emit('update:modelValue', [
    ...keptUnavailableShares.value,
    ...checkedRows.value.map(({ account }) => ({
      accountId: account.id,
      sharePercent: roundShare(draft.value[account.id]!),
    })),
  ]);
  open.value = false;
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="sm:max-w-xl">
    <template #title>{{ $t('goals.accountsDialog.title', { name: goalName }) }}</template>
    <template #description>{{ $t('goals.accountsDialog.description', { name: goalName }) }}</template>

    <div v-if="isLoading" class="divide-border grid divide-y" aria-busy="true">
      <div v-for="row in 3" :key="row" class="flex animate-pulse items-center gap-3 py-3" aria-hidden="true">
        <div class="bg-muted size-4 rounded" />
        <div class="bg-muted size-8 rounded-full" />
        <div class="grid flex-1 gap-1.5">
          <div class="bg-muted h-4 w-32 rounded" />
          <div class="bg-muted h-3 w-20 rounded" />
        </div>
      </div>
    </div>

    <div v-else-if="!goals" role="alert" class="flex flex-col items-center gap-3 py-8 text-center">
      <p class="text-destructive-text text-sm">{{ $t('goals.list.loadError') }}</p>
      <Button variant="outline" size="sm" @click="refetchGoals()">{{ $t('common.actions.retry') }}</Button>
    </div>

    <div v-else-if="!rows.length && !unavailableShares.length" class="flex flex-col items-center py-8 text-center">
      <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <WalletIcon class="text-muted-foreground size-6" />
      </div>
      <h3 class="mb-2 text-lg font-semibold">{{ $t('goals.accountsDialog.emptyState.title') }}</h3>
      <p class="text-muted-foreground max-w-sm text-sm">{{ $t('goals.accountsDialog.emptyState.description') }}</p>
    </div>

    <div v-else class="grid gap-3">
      <InputField
        v-model="search"
        type="search"
        :placeholder="$t('goals.accountsDialog.searchPlaceholder')"
        :aria-label="$t('goals.accountsDialog.searchPlaceholder')"
      >
        <template #iconLeading>
          <SearchIcon class="text-muted-foreground size-4" />
        </template>
      </InputField>

      <div role="group" :aria-label="$t('goals.form.accountsLabel')" class="divide-border grid divide-y">
        <div
          v-for="share in unavailableShares"
          :key="share.accountId"
          class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3"
        >
          <Checkbox
            :id="`goal-account-${share.accountId}`"
            :model-value="share.accountId in draft"
            @update:model-value="
              (value) => setChecked({ accountId: share.accountId, share: share.sharePercent, checked: value === true })
            "
          />
          <Label :for="`goal-account-${share.accountId}`" class="min-w-0 cursor-pointer">
            <span class="block truncate">
              {{ accountsRecord[share.accountId]?.name ?? $t('goals.form.unavailableAccount') }}
            </span>
            <span class="text-warning-text block truncate text-xs font-normal">
              {{ $t('goals.accountsDialog.unavailableCaption') }}
            </span>
          </Label>
          <span class="text-sm tabular-nums">{{ share.sharePercent }}%</span>
        </div>

        <div
          v-for="row in visibleRows"
          :key="row.account.id"
          :class="cn('grid gap-2 py-3', !isChecked(row) && row.max <= 0 && 'opacity-60')"
        >
          <div class="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3">
            <Checkbox
              :id="`goal-account-${row.account.id}`"
              :model-value="isChecked(row)"
              :disabled="!isChecked(row) && row.max <= 0"
              @update:model-value="
                (value) =>
                  setChecked({
                    accountId: row.account.id,
                    share: Math.min(FULL_SHARE, row.max),
                    checked: value === true,
                  })
              "
            />
            <AccountLogo :account="row.account" class="size-8" />
            <Label :for="`goal-account-${row.account.id}`" class="min-w-0 cursor-pointer">
              <span class="block truncate">{{ row.account.name }}</span>
              <span class="text-muted-foreground block truncate text-xs font-normal">{{ caption(row) }}</span>
            </Label>
            <div class="text-right text-sm tabular-nums">
              <div>{{ formatAmountByCurrencyCode(row.account.currentBalance, row.account.currencyCode) }}</div>
              <div v-if="row.account.currencyCode !== baseCurrency?.currencyCode" class="text-muted-foreground text-xs">
                ≈ {{ formatBaseCurrency(row.account.refCurrentBalance) }}
              </div>
            </div>
          </div>

          <div v-if="isChecked(row)" class="flex items-start gap-3 pl-7">
            <div class="w-28 shrink-0">
              <InputField
                :model-value="draft[row.account.id]"
                type="number"
                only-positive
                :placeholder="$t('goals.accountsDialog.sharePlaceholder')"
                :aria-label="$t('goals.accountsDialog.shareAriaLabel', { name: row.account.name })"
                :error-message="errorText(row)"
                trailing-icon-css-class="px-3"
                @update:model-value="(value) => setShare({ row, value })"
              >
                <template #iconTrailing>
                  <span class="text-muted-foreground text-sm">%</span>
                </template>
              </InputField>
            </div>
            <p v-if="!errorText(row)" class="text-muted-foreground pt-2 text-xs">{{ shareHint(row) }}</p>
          </div>
        </div>

        <p v-if="search.trim() && !visibleRows.length" class="text-muted-foreground py-6 text-center text-sm">
          {{ $t('goals.accountsDialog.noMatch', { query: search.trim() }) }}
        </p>
      </div>

      <p v-if="hasMarketAccount" class="text-muted-foreground text-xs">{{ $t('goals.accountsDialog.marketNote') }}</p>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <span class="text-muted-foreground text-sm">
          {{
            $t('goals.accountsDialog.total', { count: selectedCount, amount: formatBaseCurrency(total) }, selectedCount)
          }}
          <span v-if="invalidRow" class="text-destructive-text">
            {{ $t('goals.accountsDialog.fixToSave', { name: invalidRow.account.name }) }}
          </span>
        </span>
        <div class="ml-auto flex gap-2">
          <Button variant="outline" @click="open = false">{{ $t('common.actions.cancel') }}</Button>
          <Button :disabled="!isReady || !!invalidRow" @click="apply">{{ $t('goals.accountsDialog.done') }}</Button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
