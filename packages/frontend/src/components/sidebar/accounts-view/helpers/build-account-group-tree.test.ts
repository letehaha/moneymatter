import type { AccountGroups } from '@/common/types/models';
import { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { collectGroupAccounts, groupHasAccounts } from './account-totals';
import { buildAccountGroupTree } from './build-account-group-tree';
import { groupHasVisibleAccount } from './zero-balance';

const makeAccount = ({ id, currentBalance = 10 }: { id: string; currentBalance?: number }): AccountModel =>
  ({
    id,
    currentBalance,
    refCurrentBalance: currentBalance,
    creditLimit: 0,
    refCreditLimit: 0,
    currencyCode: 'USD',
  }) as AccountModel;

const makeAccounts = ({ prefix, count, currentBalance }: { prefix: string; count: number; currentBalance?: number }) =>
  Array.from({ length: count }, (_, i) => makeAccount({ id: `${prefix}-${i}`, currentBalance }));

/** The API shape: every group sits in one flat list, and a nested `childGroups` entry carries no accounts. */
const makeApiGroup = ({
  id,
  name,
  parentGroupId = null,
  accounts = [],
  childGroups = [],
}: {
  id: string;
  name: string;
  parentGroupId?: string | null;
  accounts?: AccountModel[];
  childGroups?: AccountGroups[];
}): AccountGroups => ({ id, name, parentGroupId, accounts, childGroups }) as unknown as AccountGroups;

const stub = (group: AccountGroups): AccountGroups => ({ ...group, accounts: [], childGroups: [] });

const makeOwnerApiResponse = ({ zeroKazakhstan = false }: { zeroKazakhstan?: boolean } = {}): AccountGroups[] => {
  const georgia = makeApiGroup({
    id: 'georgia',
    name: 'Georgia',
    parentGroupId: 'banks',
    accounts: makeAccounts({ prefix: 'ge', count: 2 }),
  });
  const bankIndonesia = makeApiGroup({
    id: 'bank-indonesia',
    name: 'Indonesia',
    parentGroupId: 'banks',
    accounts: makeAccounts({ prefix: 'bid', count: 2 }),
  });
  const kazakhstan = makeApiGroup({
    id: 'kazakhstan',
    name: 'Kazakhstan',
    parentGroupId: 'banks',
    accounts: makeAccounts({ prefix: 'kz', count: 17, currentBalance: zeroKazakhstan ? 0 : 10 }),
  });
  const walletIndonesia = makeApiGroup({
    id: 'wallet-indonesia',
    name: 'Indonesia',
    parentGroupId: 'e-wallets',
    accounts: makeAccounts({ prefix: 'wid', count: 3 }),
  });
  const other = makeApiGroup({
    id: 'other',
    name: 'Other',
    parentGroupId: 'e-wallets',
    accounts: makeAccounts({ prefix: 'oth', count: 2 }),
  });

  return [
    makeApiGroup({
      id: 'banks',
      name: 'Banks',
      childGroups: [stub(georgia), stub(bankIndonesia), stub(kazakhstan)],
    }),
    makeApiGroup({ id: 'cash', name: 'Cash', accounts: makeAccounts({ prefix: 'cash', count: 6 }) }),
    makeApiGroup({ id: 'crypto', name: 'Crypto', accounts: makeAccounts({ prefix: 'cr', count: 11 }) }),
    makeApiGroup({ id: 'e-wallets', name: 'E-wallets', childGroups: [stub(walletIndonesia), stub(other)] }),
    georgia,
    bankIndonesia,
    kazakhstan,
    walletIndonesia,
    other,
  ];
};

describe('buildAccountGroupTree', () => {
  it('returns only root groups at the top level, with nested groups under their parents', () => {
    const tree = buildAccountGroupTree({ groups: makeOwnerApiResponse() });

    expect(tree.map((group) => group.name).sort()).toEqual(['Banks', 'Cash', 'Crypto', 'E-wallets']);

    const banks = tree.find((group) => group.id === 'banks')!;
    expect(banks.childGroups.map((group) => group.name).sort()).toEqual(['Georgia', 'Indonesia', 'Kazakhstan']);

    const wallets = tree.find((group) => group.id === 'e-wallets')!;
    expect(wallets.childGroups.map((group) => group.name).sort()).toEqual(['Indonesia', 'Other']);
  });

  it('hydrates nested groups with their own accounts instead of the empty childGroups stubs', () => {
    const tree = buildAccountGroupTree({ groups: makeOwnerApiResponse() });
    const banks = tree.find((group) => group.id === 'banks')!;

    expect(banks.childGroups.find((group) => group.id === 'kazakhstan')!.accounts).toHaveLength(17);
  });

  it('rolls descendant accounts into a parent that has no direct accounts', () => {
    const tree = buildAccountGroupTree({ groups: makeOwnerApiResponse() });
    const banks = tree.find((group) => group.id === 'banks')!;
    const wallets = tree.find((group) => group.id === 'e-wallets')!;

    expect(banks.accounts).toHaveLength(0);
    expect(collectGroupAccounts({ group: banks })).toHaveLength(2 + 2 + 17);
    expect(collectGroupAccounts({ group: wallets })).toHaveLength(3 + 2);
  });

  it('nests grandchildren recursively', () => {
    const tree = buildAccountGroupTree({
      groups: [
        makeApiGroup({ id: 'a', name: 'A' }),
        makeApiGroup({ id: 'b', name: 'B', parentGroupId: 'a' }),
        makeApiGroup({ id: 'c', name: 'C', parentGroupId: 'b', accounts: [makeAccount({ id: 'x' })] }),
      ],
    });

    expect(tree.map((group) => group.id)).toEqual(['a']);
    expect(tree[0]!.childGroups.map((group) => group.id)).toEqual(['b']);
    expect(tree[0]!.childGroups[0]!.childGroups.map((group) => group.id)).toEqual(['c']);
    expect(collectGroupAccounts({ group: tree[0]! }).map((account) => account.id)).toEqual(['x']);
  });

  it('keeps a group at the top level when its parent is not part of the response', () => {
    const tree = buildAccountGroupTree({
      groups: [makeApiGroup({ id: 'orphan', name: 'Orphan', parentGroupId: 'missing' })],
    });

    expect(tree.map((group) => group.id)).toEqual(['orphan']);
  });

  it('does not mutate the input groups', () => {
    const groups = makeOwnerApiResponse();
    buildAccountGroupTree({ groups });

    expect(groups.find((group) => group.id === 'banks')!.childGroups[0]!.accounts).toHaveLength(0);
  });
});

describe('groupHasAccounts', () => {
  it('is true for a parent whose accounts all sit in subgroups', () => {
    const banks = buildAccountGroupTree({ groups: makeOwnerApiResponse() }).find((group) => group.id === 'banks')!;

    expect(banks.accounts).toHaveLength(0);
    expect(groupHasAccounts({ group: banks })).toBe(true);
  });

  it('is false for a group with no accounts anywhere in its subtree', () => {
    const tree = buildAccountGroupTree({
      groups: [makeApiGroup({ id: 'a', name: 'A' }), makeApiGroup({ id: 'b', name: 'B', parentGroupId: 'a' })],
    });

    expect(groupHasAccounts({ group: tree[0]! })).toBe(false);
  });
});

describe('collectGroupAccounts', () => {
  it('counts an account linked to both a parent and its subgroup once', () => {
    const shared = makeAccount({ id: 'shared' });
    const tree = buildAccountGroupTree({
      groups: [
        makeApiGroup({ id: 'a', name: 'A', accounts: [shared] }),
        makeApiGroup({ id: 'b', name: 'B', parentGroupId: 'a', accounts: [shared, makeAccount({ id: 'x' })] }),
      ],
    });

    expect(collectGroupAccounts({ group: tree[0]! }).map((account) => account.id)).toEqual(['shared', 'x']);
  });
});

describe('zero-balance hiding on the built tree', () => {
  it('judges visibility per subtree', () => {
    const tree = buildAccountGroupTree({ groups: makeOwnerApiResponse({ zeroKazakhstan: true }) });
    const banks = tree.find((group) => group.id === 'banks')!;
    const kazakhstan = banks.childGroups.find((group) => group.id === 'kazakhstan')!;
    const georgia = banks.childGroups.find((group) => group.id === 'georgia')!;

    expect(groupHasVisibleAccount({ group: kazakhstan, includeCreditLimit: false })).toBe(false);
    expect(groupHasVisibleAccount({ group: georgia, includeCreditLimit: false })).toBe(true);
    // The parent stays because other subgroups still have balances.
    expect(groupHasVisibleAccount({ group: banks, includeCreditLimit: false })).toBe(true);
  });
});
