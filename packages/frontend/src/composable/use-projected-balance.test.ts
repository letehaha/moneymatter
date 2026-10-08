import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  type AccountModel,
  type RecordId,
  type PlannedSummaryEntry,
} from '@bt/shared/types';
import { type Ref, ref } from 'vue';

const plannedEntries = ref<PlannedSummaryEntry[]>([]);

vi.mock('@/api/transactions', () => ({ loadPlannedSummary: vi.fn() }));
vi.mock('@/composable/use-date-locale', () => ({ useDateLocale: () => ({ format: () => '' }) }));
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ isUserExists: ref(true) }) }));
vi.mock('pinia', () => ({ storeToRefs: (store: unknown) => store }));
vi.mock('@/composable/data-queries/user-settings', () => ({ useUserSettings: vi.fn() }));
vi.mock('@tanstack/vue-query', () => ({
  useQuery: () => ({
    data: plannedEntries,
    isFetching: ref(false),
    isFetched: ref(true),
    isError: ref(false),
    refetch: vi.fn(),
  }),
}));

import { useUserSettings } from '@/composable/data-queries/user-settings';

import {
  aggregatePlannedSummary,
  selectProjectedTotalAccounts,
  useAccountProjectedBalance,
} from './use-projected-balance';

const id = (value: string) => value as RecordId;

const buildEntry = (overrides: Partial<PlannedSummaryEntry> = {}): PlannedSummaryEntry => ({
  accountId: id('acc-1'),
  currencyCode: 'USD',
  plannedDelta: 0,
  refPlannedDelta: 0,
  count: 0,
  latestTime: '2026-11-12T00:00:00.000Z',
  ...overrides,
});

const buildAccount = (overrides: Partial<AccountModel> = {}): AccountModel =>
  ({
    id: id('acc-1'),
    currencyCode: 'USD',
    currentBalance: 5000,
    refCurrentBalance: 5000,
    creditLimit: 0,
    refCreditLimit: 0,
    status: ACCOUNT_STATUSES.active,
    accountCategory: ACCOUNT_CATEGORIES.general,
    share: { isOwner: true } as AccountModel['share'],
    ...overrides,
  }) as AccountModel;

const setupAccount = ({
  account,
  entries,
  includeCreditLimitInStats = false,
}: {
  account: Ref<AccountModel>;
  entries: PlannedSummaryEntry[];
  includeCreditLimitInStats?: boolean;
}) => {
  plannedEntries.value = entries;
  vi.mocked(useUserSettings).mockReturnValue({
    data: ref({ includeCreditLimitInStats }),
  } as ReturnType<typeof useUserSettings>);

  return useAccountProjectedBalance({ account });
};

describe('useAccountProjectedBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plannedEntries.value = [];
  });

  it('adds the planned delta to the balance the header already shows', () => {
    const account = ref(buildAccount({ currentBalance: 4000, refCurrentBalance: 4000 }));
    const { projectedBalance, plannedCount, latestPlannedTime, hasPendingPlans } = setupAccount({
      account,
      entries: [buildEntry({ plannedDelta: -100, refPlannedDelta: -100, count: 5 })],
    });

    expect(projectedBalance.value).toBe(3900);
    expect(plannedCount.value).toBe(5);
    expect(latestPlannedTime.value).toBe('2026-11-12T00:00:00.000Z');
    expect(hasPendingPlans.value).toBe(true);
  });

  it('offsets the projected balance from the credit-limit-adjusted balance, not the raw one', () => {
    const account = ref(
      buildAccount({ currentBalance: 5000, refCurrentBalance: 5000, creditLimit: 3000, refCreditLimit: 3000 }),
    );
    const { displayBalance, projectedBalance } = setupAccount({
      account,
      entries: [buildEntry({ plannedDelta: -400, refPlannedDelta: -400, count: 2 })],
      includeCreditLimitInStats: true,
    });

    expect(displayBalance.value).toBe(2000);
    // The gap between the two numbers is the delta alone — the credit limit is applied once.
    expect(projectedBalance.value - displayBalance.value).toBe(-400);
    expect(projectedBalance.value).toBe(1600);
  });

  it('reports no pending plans when the account has no summary row', () => {
    const account = ref(buildAccount({ id: id('acc-2') }));
    const { projectedBalance, plannedCount, hasPendingPlans, latestPlannedTime } = setupAccount({
      account,
      entries: [buildEntry({ accountId: id('acc-1'), plannedDelta: -100, count: 3 })],
    });

    expect(hasPendingPlans.value).toBe(false);
    expect(plannedCount.value).toBe(0);
    expect(latestPlannedTime.value).toBeNull();
    expect(projectedBalance.value).toBe(5000);
  });
});

describe('aggregatePlannedSummary', () => {
  it('returns an empty aggregate when nothing is in scope', () => {
    expect(aggregatePlannedSummary({ entries: [], accountIds: [] })).toEqual({
      refPlannedDelta: 0,
      count: 0,
      latestTime: null,
    });
  });

  it('ignores rows for accounts outside the given scope', () => {
    const entries = [
      buildEntry({
        accountId: id('in-scope'),
        refPlannedDelta: -250,
        count: 3,
        latestTime: '2026-11-12T00:00:00.000Z',
      }),
      buildEntry({
        accountId: id('archived'),
        refPlannedDelta: -9000,
        count: 40,
        latestTime: '2027-01-01T00:00:00.000Z',
      }),
    ];

    const result = aggregatePlannedSummary({ entries, accountIds: [id('in-scope')] });

    expect(result.refPlannedDelta).toBe(-250);
    expect(result.count).toBe(3);
    expect(result.latestTime).toBe('2026-11-12T00:00:00.000Z');
  });

  it('sums scoped rows and keeps the furthest-out plan date', () => {
    const entries = [
      buildEntry({ accountId: id('a'), refPlannedDelta: -100, count: 2, latestTime: '2026-11-12T00:00:00.000Z' }),
      buildEntry({ accountId: id('b'), refPlannedDelta: 400, count: 1, latestTime: '2027-03-05T00:00:00.000Z' }),
      buildEntry({ accountId: id('c'), refPlannedDelta: -50, count: 4, latestTime: '2026-09-01T00:00:00.000Z' }),
    ];

    const result = aggregatePlannedSummary({ entries, accountIds: [id('a'), id('b'), id('c')] });

    expect(result.refPlannedDelta).toBe(250);
    expect(result.count).toBe(7);
    expect(result.latestTime).toBe('2027-03-05T00:00:00.000Z');
  });
});

describe('selectProjectedTotalAccounts', () => {
  it('keeps active money accounts and drops archived, vehicle and loan ones', () => {
    const kept = buildAccount({ id: id('kept') });
    const accounts = [
      kept,
      buildAccount({ id: id('archived'), status: ACCOUNT_STATUSES.archived }),
      buildAccount({ id: id('vehicle'), accountCategory: ACCOUNT_CATEGORIES.vehicle }),
      buildAccount({ id: id('loan'), accountCategory: ACCOUNT_CATEGORIES.loan }),
    ];

    expect(selectProjectedTotalAccounts({ accounts }).map((account) => account.id)).toEqual([id('kept')]);
  });

  it('keeps shared-in accounts, matching the Accounts page overview', () => {
    const accounts = [
      buildAccount({ id: id('owned') }),
      buildAccount({ id: id('shared'), share: { isOwner: false } as AccountModel['share'] }),
    ];

    expect(selectProjectedTotalAccounts({ accounts }).map((account) => account.id)).toEqual([
      id('owned'),
      id('shared'),
    ]);
  });
});
