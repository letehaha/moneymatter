import type { AccountGroups } from '@/common/types/models';
import { collectGroupAccounts } from '@/components/sidebar/accounts-view/helpers/account-totals';
import { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildAccountGroupList } from './build-account-group-list';

const makeAccount = ({ id }: { id: string }) => ({ id, currentBalance: 10, refCurrentBalance: 10 }) as AccountModel;

/** The API shape: a flat list where nested `childGroups` entries are stubs without accounts. */
const makeGroup = ({
  id,
  name,
  parentGroupId = null,
  accountCount = 0,
}: {
  id: string;
  name: string;
  parentGroupId?: string | null;
  accountCount?: number;
}) =>
  ({
    id,
    name,
    parentGroupId,
    accounts: Array.from({ length: accountCount }, (_, i) => makeAccount({ id: `${id}-${i}` })),
    childGroups: [],
  }) as unknown as AccountGroups;

const makeOwnerGroups = (): AccountGroups[] => [
  makeGroup({ id: 'banks', name: 'Banks' }),
  makeGroup({ id: 'cash', name: 'Cash', accountCount: 6 }),
  makeGroup({ id: 'crypto', name: 'Crypto', accountCount: 11 }),
  makeGroup({ id: 'e-wallets', name: 'E-wallets' }),
  makeGroup({ id: 'ge', name: 'Georgia', parentGroupId: 'banks', accountCount: 2 }),
  makeGroup({ id: 'bank-id', name: 'Indonesia', parentGroupId: 'banks', accountCount: 2 }),
  makeGroup({ id: 'kz', name: 'Kazakhstan', parentGroupId: 'banks', accountCount: 17 }),
  makeGroup({ id: 'ru', name: 'Russia', parentGroupId: 'banks', accountCount: 2 }),
  makeGroup({ id: 'vn', name: 'Vietnam', parentGroupId: 'banks', accountCount: 1 }),
  makeGroup({ id: 'wallet-id', name: 'Indonesia', parentGroupId: 'e-wallets', accountCount: 3 }),
  makeGroup({ id: 'other', name: 'Other', parentGroupId: 'e-wallets', accountCount: 2 }),
];

describe('buildAccountGroupList', () => {
  it('returns an empty list when there are no groups', () => {
    expect(buildAccountGroupList({ groups: [] })).toEqual([]);
  });

  it('sorts top-level groups alphabetically by name', () => {
    const groups = [
      makeGroup({ id: '1', name: 'Wise' }),
      makeGroup({ id: '2', name: 'Cash' }),
      makeGroup({ id: '3', name: 'Monobank' }),
    ];

    expect(buildAccountGroupList({ groups }).map((item) => item.group.name)).toEqual(['Cash', 'Monobank', 'Wise']);
  });

  it('shows only root groups at the top level, with subgroups nested and sorted under their parent', () => {
    const list = buildAccountGroupList({ groups: makeOwnerGroups() });

    expect(list.map((item) => item.group.name)).toEqual(['Banks', 'Cash', 'Crypto', 'E-wallets']);
    expect(list[0]!.children.map((item) => item.group.name)).toEqual([
      'Georgia',
      'Indonesia',
      'Kazakhstan',
      'Russia',
      'Vietnam',
    ]);
    expect(list[3]!.children.map((item) => item.group.name)).toEqual(['Indonesia', 'Other']);
  });

  it('keeps the two Indonesia groups under their own parents', () => {
    const list = buildAccountGroupList({ groups: makeOwnerGroups() });

    expect(list[0]!.children[1]!.group.id).toBe('bank-id');
    expect(list[3]!.children[0]!.group.id).toBe('wallet-id');
  });

  it('hydrates nested rows with their own accounts and lets a parent roll its subtree up', () => {
    const [banks, , , eWallets] = buildAccountGroupList({ groups: makeOwnerGroups() });

    expect(banks!.group.accounts).toHaveLength(0);
    expect(banks!.children.find((item) => item.group.id === 'kz')!.group.accounts).toHaveLength(17);
    expect(collectGroupAccounts({ group: banks!.group })).toHaveLength(24);
    expect(collectGroupAccounts({ group: eWallets!.group })).toHaveLength(5);
  });

  it('nests more than one level deep', () => {
    const groups = [
      makeGroup({ id: 'root', name: 'Everything' }),
      makeGroup({ id: 'mid', name: 'Banks', parentGroupId: 'root' }),
      makeGroup({ id: 'leaf', name: 'Wise', parentGroupId: 'mid', accountCount: 1 }),
    ];

    const [root] = buildAccountGroupList({ groups });

    expect(root!.children[0]!.group.id).toBe('mid');
    expect(root!.children[0]!.children[0]!.group.id).toBe('leaf');
    expect(collectGroupAccounts({ group: root!.group })).toHaveLength(1);
  });

  it('keeps a group whose parent is missing from the response at the top level', () => {
    const groups = [
      makeGroup({ id: 'top', name: 'Cash' }),
      makeGroup({ id: 'orphan', name: 'Wise', parentGroupId: 'not-in-response' }),
    ];

    expect(buildAccountGroupList({ groups }).map((item) => item.group.id)).toEqual(['top', 'orphan']);
  });
});
