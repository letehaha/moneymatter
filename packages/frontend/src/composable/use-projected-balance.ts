import { loadPlannedSummary } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useAccountDisplayBalance } from '@/composable/use-account-display-balance';
import { useDateLocale } from '@/composable/use-date-locale';
import { useUserStore } from '@/stores/user';
import {
  ACCOUNT_STATUSES,
  type AccountModel,
  type RecordId,
  isDedicatedFlowAccountCategory,
  type PlannedSummaryEntry,
} from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { type Ref, computed } from 'vue';

export interface PlannedAggregate {
  /** Income minus expenses over the scoped pending plans, in the user's base currency. */
  refPlannedDelta: number;
  count: number;
  /** ISO datetime of the furthest-out plan in the scope, or null when there are none. */
  latestTime: string | null;
}

/**
 * The endpoint covers every account the caller owns, archived included, so a total placed
 * next to a real total has to name the same accounts or the two figures describe different
 * sets.
 */
export const aggregatePlannedSummary = ({
  entries,
  accountIds,
}: {
  entries: PlannedSummaryEntry[];
  accountIds: Iterable<RecordId>;
}): PlannedAggregate => {
  const scope = new Set(accountIds);
  let refPlannedDelta = 0;
  let count = 0;
  let latestTime: string | null = null;

  for (const entry of entries) {
    if (!scope.has(entry.accountId)) continue;

    refPlannedDelta += entry.refPlannedDelta;
    count += entry.count;
    if (latestTime === null || new Date(entry.latestTime) > new Date(latestTime)) {
      latestTime = entry.latestTime;
    }
  }

  return { refPlannedDelta, count, latestTime };
};

/**
 * Excludes archived accounts and the derived-balance categories (vehicles, loans). A projection
 * must cover the same accounts as the total it sits beside, or the two figures describe
 * different sets.
 */
export const selectProjectedTotalAccounts = ({ accounts }: { accounts: AccountModel[] }): AccountModel[] =>
  accounts.filter(
    (account) =>
      account.status !== ACCOUNT_STATUSES.archived && !isDedicatedFlowAccountCategory(account.accountCategory),
  );

/** Renders the "through {date}" bound every projected-balance label carries. */
export const usePlannedDateLabel = () => {
  const { format } = useDateLocale();

  const formatPlannedDate = ({ time }: { time: string | null }): string => {
    if (!time) return '';
    const date = new Date(time);
    return format(date, date.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy');
  };

  return { formatPlannedDate };
};

/** Pending planned rows aggregated per account, as one shared query. */
export const useProjectedBalance = () => {
  const { isUserExists } = storeToRefs(useUserStore());

  const query = useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.plannedSummary,
    queryFn: loadPlannedSummary,
    enabled: isUserExists,
    staleTime: Infinity,
    placeholderData: [] as PlannedSummaryEntry[],
  });

  const entries = computed<PlannedSummaryEntry[]>(() => query.data.value ?? []);
  const entriesByAccountId = computed(() => new Map(entries.value.map((entry) => [entry.accountId, entry])));

  const getAccountPlanned = ({ accountId }: { accountId: RecordId }): PlannedSummaryEntry | null =>
    entriesByAccountId.value.get(accountId) ?? null;

  const aggregateFor = ({ accountIds }: { accountIds: Iterable<RecordId> }): PlannedAggregate =>
    aggregatePlannedSummary({ entries: entries.value, accountIds });

  return {
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isError: query.isError,
    refetch: query.refetch,
    getAccountPlanned,
    aggregateFor,
  };
};

/**
 * Built on `useAccountDisplayBalance` so the credit-limit setting is applied once, to the
 * balance only. The delta is never scaled by the limit.
 */
export const useAccountProjectedBalance = ({ account }: { account: Ref<AccountModel> }) => {
  const { displayBalance, displayRefBalance } = useAccountDisplayBalance({ account });
  const { getAccountPlanned } = useProjectedBalance();

  const planned = computed(() => getAccountPlanned({ accountId: account.value.id }));

  const plannedDelta = computed(() => planned.value?.plannedDelta ?? 0);
  const refPlannedDelta = computed(() => planned.value?.refPlannedDelta ?? 0);
  const plannedCount = computed(() => planned.value?.count ?? 0);
  const latestPlannedTime = computed(() => planned.value?.latestTime ?? null);
  const hasPendingPlans = computed(() => plannedCount.value > 0);

  const projectedBalance = computed(() => displayBalance.value + plannedDelta.value);

  return {
    displayBalance,
    displayRefBalance,
    plannedDelta,
    refPlannedDelta,
    plannedCount,
    latestPlannedTime,
    hasPendingPlans,
    projectedBalance,
  };
};
