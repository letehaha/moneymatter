<script setup lang="ts">
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const';
import AccountLogo from '@/components/common/account-logo.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { Label } from '@/components/lib/ui/label';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { useFormatCurrency } from '@/composable';
import { useGoals } from '@/composable/data-queries/goals';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { FULL_SHARE, roundShare } from '@bt/shared/goals/goal-math';
import { ACCOUNT_STATUSES, type AccountModel, type GoalAccountShare, type RecordId } from '@bt/shared/types';
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, SearchIcon, WalletIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useI18n } from 'vue-i18n';

import { getShareError, isGoalEligibleAccount, parseNumberOrNull } from '../form-helpers';
import {
  type FixedAmountHolder,
  MARKET_CATEGORIES,
  countedFromAccount,
  formatGoalLinkLabel,
  getAccountFixedHolders,
  getAccountShareCapacity,
} from '../helpers';

const props = defineProps<{ goalName: string; modelValue: GoalAccountShare[]; editingGoalId?: RecordId }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ 'update:modelValue': [shares: GoalAccountShare[]] }>();

const { t } = useI18n();
const { formatAccountAmount, formatBaseCurrency, baseCurrencyDecimals } = useFormatCurrency();
const { accounts, accountsRecord, isAccountsFetched } = storeToRefs(useAccountsStore());
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const { data: goals, isLoading: isGoalsLoading, refetch: refetchGoals } = useGoals();

const isLoading = computed(() => isGoalsLoading.value || !isAccountsFetched.value);
const isReady = computed(() => !isLoading.value && !!goals.value);

type ShareMode = 'percent' | 'amount';
interface DraftShare {
  mode: ShareMode;
  sharePercent: number | null;
  fixedAmount: number | null;
  /** Index among the account's other fixed amounts. */
  fixedPosition: number | null;
}

/** Ticked accounts; a key present means checked. */
const draft = ref<Record<string, DraftShare>>({});
const search = ref('');

const toDraft = ({ share }: { share: GoalAccountShare }): DraftShare => ({
  mode: share.fixedAmount === null ? 'percent' : 'amount',
  sharePercent: share.sharePercent,
  fixedAmount: share.fixedAmount,
  fixedPosition: share.fixedPosition,
});

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    draft.value = Object.fromEntries(props.modelValue.map((share) => [share.accountId, toDraft({ share })]));
    search.value = '';
  },
  { immediate: true },
);

const editingGoal = computed(() => (goals.value ?? []).find((goal) => goal.id === props.editingGoalId));

interface AccountRow {
  account: AccountModel;
  max: number;
  holders: string;
  fixedHolders: FixedAmountHolder[];
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
        fixedHolders: getAccountFixedHolders({
          goals: goals.value ?? [],
          accountId: account.id,
          editingGoalId: props.editingGoalId,
        }),
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

const setChecked = ({ accountId, share, checked }: { accountId: RecordId; share: DraftShare; checked: boolean }) => {
  const next = { ...draft.value };
  if (checked) next[accountId] = share;
  else delete next[accountId];
  draft.value = next;
};

const newDraftFor = ({
  row,
  mode = row.max > 0 ? 'percent' : 'amount',
}: {
  row: AccountRow;
  mode?: ShareMode;
}): DraftShare =>
  mode === 'percent'
    ? { mode, sharePercent: Math.min(FULL_SHARE, row.max), fixedAmount: null, fixedPosition: null }
    : { mode, sharePercent: null, fixedAmount: null, fixedPosition: row.fixedHolders.length };

const isAmountMode = ({ row }: { row: AccountRow }) => draft.value[row.account.id]?.mode === 'amount';

const updateDraft = ({ row, patch }: { row: AccountRow; patch: Partial<DraftShare> }) => {
  draft.value = { ...draft.value, [row.account.id]: { ...draft.value[row.account.id]!, ...patch } };
};

const setMode = ({ row, mode }: { row: AccountRow; mode: ShareMode }) => {
  if (draft.value[row.account.id]!.mode === mode) return;
  updateDraft({ row, patch: newDraftFor({ row, mode }) });
};

const modeItems = computed(() => [
  { value: 'percent', label: t('goals.accountsDialog.mode.percent') },
  { value: 'amount', label: t('goals.accountsDialog.mode.amount') },
]);

type RowError = 'invalid' | 'overMax' | 'invalidAmount' | null;

const shareErrorOf = ({ row }: { row: AccountRow }): RowError => {
  const share = draft.value[row.account.id];
  if (!share) return null;
  if (share.mode === 'amount') return share.fixedAmount !== null && share.fixedAmount > 0 ? null : 'invalidAmount';
  return getShareError({ sharePercent: share.sharePercent, max: row.max });
};

const errorText = ({ row }: { row: AccountRow }) => {
  const error = shareErrorOf({ row });
  if (!error) return undefined;
  if (error === 'invalidAmount') return t('goals.accountsDialog.errors.invalidAmount');
  if (row.max <= 0) return t('goals.accountsDialog.errors.noShareLeft', { holders: row.holders });
  if (error === 'invalid') return t('goals.accountsDialog.errors.invalid');
  return row.holders
    ? t('goals.accountsDialog.errors.overMaxUsedBy', { max: row.max, holders: row.holders })
    : t('goals.accountsDialog.errors.overMax', { max: row.max });
};

const toShare = ({ accountId, share }: { accountId: RecordId; share: DraftShare }): GoalAccountShare =>
  share.mode === 'percent'
    ? { accountId, sharePercent: roundShare(share.sharePercent ?? 0), fixedAmount: null, fixedPosition: null }
    : { accountId, sharePercent: null, fixedAmount: share.fixedAmount ?? 0, fixedPosition: share.fixedPosition };

const countedOf = ({ row }: { row: AccountRow }) => {
  const share = draft.value[row.account.id]!;
  return countedFromAccount({
    account: row.account,
    share: toShare({
      accountId: row.account.id,
      share: share.mode === 'percent' ? { ...share, sharePercent: Math.min(share.sharePercent ?? 0, row.max) } : share,
    }),
    holders: row.fixedHolders,
    baseDecimals: baseCurrencyDecimals.value,
  });
};

const formatCounted = ({ amount }: { amount: number | null }) => (amount === null ? '—' : formatBaseCurrency(amount));

const shareHint = ({ row }: { row: AccountRow }) => {
  const amount = formatCounted({ amount: countedOf({ row }) });
  const share = draft.value[row.account.id]!;
  if (share.mode === 'amount') return t('goals.accountsDialog.counts', { amount });
  if (share.sharePercent === FULL_SHARE) return t('goals.accountsDialog.wholeAccount', { amount });
  if (row.max < FULL_SHARE) return t('goals.accountsDialog.maxShare', { max: row.max, amount });
  return t('goals.accountsDialog.counts', { amount });
};

const caption = (row: AccountRow) => {
  const { account } = row;
  const parts = [t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[account.accountCategory])];
  if (account.currencyCode !== baseCurrency.value?.currencyCode) parts.push(account.currencyCode);
  if (account.status === ACCOUNT_STATUSES.archived) parts.push(t('goals.accountsDialog.archived'));
  if (!isChecked(row) && row.max <= 0) parts.push(t('goals.accountsDialog.fixedOnly', { holders: row.holders }));
  else if (!isChecked(row) && row.max < FULL_SHARE) parts.push(t('goals.accountsDialog.free', { free: row.max }));
  return parts.join(' · ');
};

const OWN_ORDER_ID = 'own';
type OrderItem = { id: RecordId | typeof OWN_ORDER_ID; name: string; fixedAmount: number };

/** The account's fixed amounts in fill order, this goal's included; null while it's the only one. */
const orderOf = ({ row }: { row: AccountRow }): OrderItem[] | null => {
  const share = draft.value[row.account.id];
  if (share?.mode !== 'amount' || !row.fixedHolders.length) return null;
  const items: OrderItem[] = row.fixedHolders.map(({ goalId, name, fixedAmount }) => ({
    id: goalId,
    name,
    fixedAmount,
  }));
  const position = Math.min(share.fixedPosition ?? items.length, items.length);
  items.splice(position, 0, { id: OWN_ORDER_ID, name: props.goalName, fixedAmount: share.fixedAmount ?? 0 });
  return items;
};

const setOrder = ({ row, items }: { row: AccountRow; items: OrderItem[] }) => {
  updateDraft({ row, patch: { fixedPosition: items.findIndex((item) => item.id === OWN_ORDER_ID) } });
};

const moveOwn = ({ row, items, index, by }: { row: AccountRow; items: OrderItem[]; index: number; by: -1 | 1 }) => {
  const next = [...items];
  [next[index], next[index + by]] = [next[index + by]!, next[index]!];
  setOrder({ row, items: next });
};

const checkedRows = computed(() => rows.value.filter(isChecked));
const invalidRow = computed(() => checkedRows.value.find((row) => shareErrorOf({ row }) !== null));
const total = computed(() => {
  if (!isReady.value) return null;
  return checkedRows.value.reduce<number | null>((sum, row) => {
    const counted = countedOf({ row });
    return sum === null || counted === null ? null : sum + counted;
  }, 0);
});
const hasMarketAccount = computed(() =>
  checkedRows.value.some(({ account }) => MARKET_CATEGORIES.includes(account.accountCategory)),
);
const hasFixedAmount = computed(() => checkedRows.value.some((row) => isAmountMode({ row })));

const setValue = ({ row, value }: { row: AccountRow; value: string | number | null }) => {
  const parsed = parseNumberOrNull(value);
  updateDraft({ row, patch: isAmountMode({ row }) ? { fixedAmount: parsed } : { sharePercent: parsed } });
};

const unavailableLabel = ({ share }: { share: GoalAccountShare }) =>
  formatGoalLinkLabel({
    share,
    currencyCode: accountsRecord.value[share.accountId]?.currencyCode,
    formatAmount: ({ amount }) => formatAccountAmount({ amount, account: accountsRecord.value[share.accountId]! }),
  });

const selectedCount = computed(() => checkedRows.value.length + keptUnavailableShares.value.length);

const apply = () => {
  if (!isReady.value || invalidRow.value) return;
  emit('update:modelValue', [
    ...keptUnavailableShares.value,
    ...checkedRows.value.map(({ account }) => toShare({ accountId: account.id, share: draft.value[account.id]! })),
  ]);
  open.value = false;
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="sm:max-w-xl">
    <template #title>{{ $t('goals.accountsDialog.title', { name: goalName }) }}</template>
    <template #description>
      {{ $t('goals.accountsDialog.description', { name: goalName }) }}
      {{ $t('goals.accountsDialog.fixedFirst') }}
    </template>

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
              (value) => setChecked({ accountId: share.accountId, share: toDraft({ share }), checked: value === true })
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
          <span class="text-sm tabular-nums">{{ unavailableLabel({ share }) }}</span>
        </div>

        <div v-for="row in visibleRows" :key="row.account.id" class="grid gap-2 py-3">
          <div class="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3">
            <Checkbox
              :id="`goal-account-${row.account.id}`"
              :model-value="isChecked(row)"
              @update:model-value="
                (value) =>
                  setChecked({ accountId: row.account.id, share: newDraftFor({ row }), checked: value === true })
              "
            />
            <AccountLogo :account="row.account" class="size-8" />
            <Label :for="`goal-account-${row.account.id}`" class="min-w-0 cursor-pointer">
              <span class="block truncate">{{ row.account.name }}</span>
              <span class="text-muted-foreground block truncate text-xs font-normal">{{ caption(row) }}</span>
            </Label>
            <div class="text-right text-sm tabular-nums">
              <div>{{ formatAccountAmount({ amount: row.account.currentBalance, account: row.account }) }}</div>
              <div v-if="row.account.currencyCode !== baseCurrency?.currencyCode" class="text-muted-foreground text-xs">
                ≈ {{ formatBaseCurrency(row.account.refCurrentBalance) }}
              </div>
            </div>
          </div>

          <div v-if="draft[row.account.id]" class="grid gap-2 pl-7">
            <div class="flex flex-wrap items-start gap-3">
              <PillTabs
                :items="modeItems"
                :model-value="draft[row.account.id]!.mode"
                size="sm"
                class="mt-1"
                @update:model-value="(mode) => setMode({ row, mode: mode as ShareMode })"
              />
              <div class="w-36 shrink-0">
                <InputField
                  :model-value="
                    isAmountMode({ row }) ? draft[row.account.id]!.fixedAmount : draft[row.account.id]!.sharePercent
                  "
                  type="number"
                  only-positive
                  :decimals="
                    isAmountMode({ row })
                      ? getCurrencyDecimals({ code: row.account.currencyCode, meta: row.account.currencyMeta })
                      : undefined
                  "
                  :placeholder="
                    isAmountMode({ row })
                      ? $t('goals.accountsDialog.amountPlaceholder')
                      : $t('goals.accountsDialog.sharePlaceholder')
                  "
                  :aria-label="
                    isAmountMode({ row })
                      ? $t('goals.accountsDialog.amountAriaLabel', { name: row.account.name })
                      : $t('goals.accountsDialog.shareAriaLabel', { name: row.account.name })
                  "
                  :error-message="errorText({ row })"
                  trailing-icon-css-class="px-3"
                  @update:model-value="(value) => setValue({ row, value })"
                >
                  <template #iconTrailing>
                    <span class="text-muted-foreground text-sm">
                      {{ isAmountMode({ row }) ? row.account.currencyCode : '%' }}
                    </span>
                  </template>
                </InputField>
              </div>
              <p v-if="!errorText({ row })" class="text-muted-foreground pt-2 text-xs">{{ shareHint({ row }) }}</p>
            </div>

            <div v-if="orderOf({ row })" class="bg-muted/40 grid gap-1 rounded-md p-2">
              <p class="text-muted-foreground px-1 text-xs">{{ $t('goals.accountsDialog.order.hint') }}</p>
              <VueDraggable
                :model-value="orderOf({ row })!"
                handle=".drag-handle"
                :animation="200"
                class="grid gap-0.5"
                @update:model-value="(items: OrderItem[]) => setOrder({ row, items })"
              >
                <div
                  v-for="(item, index) in orderOf({ row })!"
                  :key="item.id"
                  :class="
                    cn(
                      'grid grid-cols-[1rem_1rem_minmax(0,1fr)_auto_4rem] items-center gap-2 rounded-md px-1 py-1 text-sm',
                      item.id === OWN_ORDER_ID && 'bg-background',
                    )
                  "
                >
                  <GripVerticalIcon
                    v-if="item.id === OWN_ORDER_ID"
                    class="drag-handle text-muted-foreground size-4 cursor-grab"
                    :aria-label="$t('goals.accountsDialog.order.dragLabel')"
                  />
                  <span v-else />
                  <span class="text-muted-foreground text-xs tabular-nums">{{ index + 1 }}</span>
                  <span :class="cn('truncate', item.id !== OWN_ORDER_ID && 'text-muted-foreground')">
                    {{
                      item.id === OWN_ORDER_ID
                        ? $t('goals.accountsDialog.order.thisGoal', { name: item.name })
                        : item.name
                    }}
                  </span>
                  <span class="tabular-nums">
                    {{ formatAccountAmount({ amount: item.fixedAmount, account: row.account }) }}
                  </span>
                  <div v-if="item.id === OWN_ORDER_ID" class="flex">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="index === 0"
                      :aria-label="$t('goals.accountsDialog.order.moveUp')"
                      @click="moveOwn({ row, items: orderOf({ row })!, index, by: -1 })"
                    >
                      <ChevronUpIcon class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="index === orderOf({ row })!.length - 1"
                      :aria-label="$t('goals.accountsDialog.order.moveDown')"
                      @click="moveOwn({ row, items: orderOf({ row })!, index, by: 1 })"
                    >
                      <ChevronDownIcon class="size-4" />
                    </Button>
                  </div>
                  <span v-else />
                </div>
              </VueDraggable>
            </div>
          </div>
        </div>

        <p v-if="search.trim() && !visibleRows.length" class="text-muted-foreground py-6 text-center text-sm">
          {{ $t('goals.accountsDialog.noMatch', { query: search.trim() }) }}
        </p>
      </div>

      <p v-if="hasMarketAccount" class="text-muted-foreground text-xs">{{ $t('goals.accountsDialog.marketNote') }}</p>
      <p v-if="hasFixedAmount" class="text-muted-foreground text-xs">
        {{ $t('goals.accountsDialog.fixedCurrencyNote') }}
      </p>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <span class="text-muted-foreground text-sm">
          {{
            $t(
              'goals.accountsDialog.total',
              { count: selectedCount, amount: formatCounted({ amount: total }) },
              selectedCount,
            )
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
