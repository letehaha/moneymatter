import type { AccountGroups } from '@/common/types/models';
import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  type RecordId,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildGroupedAccountsGroups,
  filterSelectableAccounts,
  flattenGroupAccounts,
  sortAccounts,
} from './use-grouped-accounts';

const makeAccount = (overrides: Partial<AccountModel> = {}): AccountModel => ({
  type: ACCOUNT_TYPES.system,
  id: '00000000-0000-0000-0000-000000000001' as RecordId,
  name: 'Cash',
  initialBalance: 0,
  refInitialBalance: 0,
  currentBalance: 0,
  refCurrentBalance: 0,
  creditLimit: 0,
  refCreditLimit: 0,
  accountCategory: ACCOUNT_CATEGORIES.general,
  currencyCode: 'USD',
  userId: 1,
  status: ACCOUNT_STATUSES.active,
  excludeFromStats: false,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

const makeGroup = ({
  id,
  accounts = [],
  childGroups,
}: {
  id: string;
  accounts?: AccountModel[];
  childGroups?: AccountGroups[];
}): AccountGroups =>
  ({
    id,
    name: id,
    accounts,
    childGroups,
  }) as unknown as AccountGroups;

describe('flattenGroupAccounts', () => {
  it('flattens a nested group tree, including grandchildren, in tree order', () => {
    const a = makeAccount({ id: 'a' as RecordId, name: 'A' });
    const b = makeAccount({ id: 'b' as RecordId, name: 'B' });
    const c = makeAccount({ id: 'c' as RecordId, name: 'C' });
    const group = makeGroup({
      id: 'top',
      accounts: [a],
      childGroups: [
        makeGroup({
          id: 'child',
          accounts: [b],
          childGroups: [makeGroup({ id: 'grandchild', accounts: [c] })],
        }),
      ],
    });

    expect(flattenGroupAccounts({ group }).map((account) => account.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the group own accounts when there are no child groups', () => {
    const a = makeAccount({ id: 'a' as RecordId });
    const group = makeGroup({ id: 'top', accounts: [a], childGroups: [] });
    expect(flattenGroupAccounts({ group }).map((account) => account.id)).toEqual(['a']);
  });

  it('tolerates a missing childGroups field', () => {
    const a = makeAccount({ id: 'a' as RecordId });
    const group = makeGroup({ id: 'top', accounts: [a] });
    expect(flattenGroupAccounts({ group }).map((account) => account.id)).toEqual(['a']);
  });

  it('returns an empty list for an empty group', () => {
    expect(flattenGroupAccounts({ group: makeGroup({ id: 'empty' }) })).toEqual([]);
  });
});

describe('sortAccounts', () => {
  it('puts balance-holding accounts first, then falls back to alphabetical within each group', () => {
    const accounts = [
      makeAccount({ id: '1' as RecordId, name: 'Alpha', currentBalance: 0 }),
      makeAccount({ id: '2' as RecordId, name: 'Zebra', currentBalance: 100 }),
      makeAccount({ id: '3' as RecordId, name: 'Beta', currentBalance: 0 }),
      makeAccount({ id: '4' as RecordId, name: 'Mango', currentBalance: 50 }),
    ];

    expect(sortAccounts({ accounts }).map((account) => account.name)).toEqual(['Mango', 'Zebra', 'Alpha', 'Beta']);
  });

  it('does not mutate the input array', () => {
    const accounts = [
      makeAccount({ id: '1' as RecordId, name: 'B', currentBalance: 0 }),
      makeAccount({ id: '2' as RecordId, name: 'A', currentBalance: 100 }),
    ];
    const original = [...accounts];
    sortAccounts({ accounts });
    expect(accounts).toEqual(original);
  });
});

describe('filterSelectableAccounts', () => {
  const active = makeAccount({ id: 'active' as RecordId, name: 'Active', status: ACCOUNT_STATUSES.active });
  const archived = makeAccount({ id: 'archived' as RecordId, name: 'Archived', status: ACCOUNT_STATUSES.archived });
  const loan = makeAccount({ id: 'loan' as RecordId, name: 'Loan', accountCategory: ACCOUNT_CATEGORIES.loan });
  const vehicle = makeAccount({
    id: 'vehicle' as RecordId,
    name: 'Vehicle',
    accountCategory: ACCOUNT_CATEGORIES.vehicle,
  });

  it('drops archived accounts by default', () => {
    expect(filterSelectableAccounts({ accounts: [active, archived] }).map((a) => a.id)).toEqual(['active']);
  });

  it('keeps archived accounts when includeArchived is set', () => {
    expect(filterSelectableAccounts({ accounts: [active, archived], includeArchived: true }).map((a) => a.id)).toEqual([
      'active',
      'archived',
    ]);
  });

  it('keeps loan and vehicle accounts by default', () => {
    expect(filterSelectableAccounts({ accounts: [active, loan, vehicle] }).map((a) => a.id)).toEqual([
      'active',
      'loan',
      'vehicle',
    ]);
  });

  it('drops loan and vehicle (dedicated-flow) accounts when excludeDedicatedFlow is set', () => {
    expect(
      filterSelectableAccounts({ accounts: [active, loan, vehicle], excludeDedicatedFlow: true }).map((a) => a.id),
    ).toEqual(['active']);
  });

  it('composes the archived and dedicated-flow filters', () => {
    const archivedLoan = makeAccount({
      id: 'archived-loan' as RecordId,
      status: ACCOUNT_STATUSES.archived,
      accountCategory: ACCOUNT_CATEGORIES.loan,
    });
    expect(
      filterSelectableAccounts({
        accounts: [active, archived, loan, vehicle, archivedLoan],
        excludeDedicatedFlow: true,
      }).map((a) => a.id),
    ).toEqual(['active']);
  });
});

describe('buildGroupedAccountsGroups', () => {
  const apiGroup = ({
    id,
    parentGroupId = null,
    accounts = [],
    childGroups = [],
  }: {
    id: string;
    parentGroupId?: string | null;
    accounts?: AccountModel[];
    childGroups?: AccountGroups[];
  }) => ({ id, name: id, parentGroupId, accounts, childGroups }) as unknown as AccountGroups;
  const stub = (group: AccountGroups) => ({ ...group, accounts: [], childGroups: [] }) as AccountGroups;

  it('folds nested groups into their root from the flat API response, without duplicate top-level rows', () => {
    const georgia = apiGroup({
      id: 'georgia',
      parentGroupId: 'banks',
      accounts: [makeAccount({ id: 'g1' as RecordId })],
    });
    const bankIndonesia = apiGroup({
      id: 'bank-indonesia',
      parentGroupId: 'banks',
      accounts: [makeAccount({ id: 'bi1' as RecordId })],
    });
    const walletIndonesia = apiGroup({
      id: 'wallet-indonesia',
      parentGroupId: 'e-wallets',
      accounts: [makeAccount({ id: 'wi1' as RecordId })],
    });
    const cash = apiGroup({ id: 'cash', accounts: [makeAccount({ id: 'c1' as RecordId })] });
    const accountGroups = [
      apiGroup({ id: 'banks', childGroups: [stub(georgia), stub(bankIndonesia)] }),
      cash,
      apiGroup({ id: 'e-wallets', childGroups: [stub(walletIndonesia)] }),
      georgia,
      bankIndonesia,
      walletIndonesia,
    ];
    const visible = new Set(['g1', 'bi1', 'wi1', 'c1']);

    const groups = buildGroupedAccountsGroups({ accountGroups, visibleAccountIds: visible });

    expect(groups.map((group) => group.id).sort()).toEqual(['banks', 'cash', 'e-wallets']);
    expect(
      groups
        .find((group) => group.id === 'banks')!
        .accounts.map((account) => account.id)
        .sort(),
    ).toEqual(['bi1', 'g1']);
    expect(groups.find((group) => group.id === 'e-wallets')!.accounts.map((account) => account.id)).toEqual(['wi1']);
  });

  it('drops a root whose descendant accounts are all filtered out', () => {
    const child = apiGroup({
      id: 'child',
      parentGroupId: 'root',
      accounts: [makeAccount({ id: 'x' as RecordId })],
    });
    const groups = buildGroupedAccountsGroups({
      accountGroups: [apiGroup({ id: 'root', childGroups: [stub(child)] }), child],
      visibleAccountIds: new Set<string>(),
    });

    expect(groups).toEqual([]);
  });
});
