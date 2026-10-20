import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/common/utils/build-account-group-tree';
import type { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { type AccountGroupTreeRow, buildAccountGroupList, listTreeRows } from './build-account-group-list';
import { makeGroup } from './test-fixtures';

const build = ({ groups }: { groups: AccountGroups[] }) =>
  buildAccountGroupList({ groups: buildAccountGroupTree({ groups }) });

describe('buildAccountGroupList', () => {
  it('returns an empty list when there are no groups', () => {
    expect(build({ groups: [] })).toEqual([]);
  });

  it('sorts top-level groups alphabetically by name', () => {
    const groups = [
      makeGroup({ id: '1', name: 'Wise' }),
      makeGroup({ id: '2', name: 'Cash' }),
      makeGroup({ id: '3', name: 'Monobank' }),
    ];

    expect(build({ groups }).map((item) => item.group.name)).toEqual(['Cash', 'Monobank', 'Wise']);
  });

  it('nests children sorted by name under their parent', () => {
    const list = build({
      groups: [
        makeGroup({ id: 'vn', name: 'Vietnam', parentGroupId: 'banks' }),
        makeGroup({ id: 'banks', name: 'Banks' }),
        makeGroup({ id: 'ge', name: 'Georgia', parentGroupId: 'banks' }),
      ],
    });

    expect(list.map((item) => item.group.name)).toEqual(['Banks']);
    expect(list[0]!.children.map((item) => item.group.name)).toEqual(['Georgia', 'Vietnam']);
  });
});

describe('listTreeRows', () => {
  const account = { id: 'acc-1', name: 'Card' } as AccountModel;
  const nestedAccount = { id: 'acc-2', name: 'Lari card' } as AccountModel;
  const groups = buildAccountGroupTree({
    groups: [
      makeGroup({ id: 'banks', name: 'Banks', accounts: [account] }),
      makeGroup({ id: 'ge', name: 'Georgia', parentGroupId: 'banks' }),
      makeGroup({ id: 'tb', name: 'Tbilisi', parentGroupId: 'ge', accounts: [nestedAccount] }),
      makeGroup({ id: 'cash', name: 'Cash' }),
    ],
  });
  const items = buildAccountGroupList({ groups });
  const describeRows = (rows: AccountGroupTreeRow[]) =>
    rows.map((row) => `${row.depth}:${row.type === 'group' ? row.item.group.id : row.account.id}`);

  it('lists only top-level groups when nothing is expanded', () => {
    expect(describeRows(listTreeRows({ items, isExpanded: () => false, includeAccounts: true }))).toEqual([
      '0:banks',
      '0:cash',
    ]);
  });

  it('lists subgroups before the group accounts when expanded', () => {
    const rows = listTreeRows({
      items,
      isExpanded: ({ id }) => id === 'banks',
      includeAccounts: true,
    });
    expect(describeRows(rows)).toEqual(['0:banks', '1:ge', '1:acc-1', '0:cash']);
  });

  it('omits accounts when asked', () => {
    const rows = listTreeRows({
      items,
      isExpanded: () => true,
      includeAccounts: false,
    });
    expect(describeRows(rows)).toEqual(['0:banks', '1:ge', '2:tb', '0:cash']);
  });

  it('indents each nested level one deeper when expanded', () => {
    const rows = listTreeRows({ items, isExpanded: () => true, includeAccounts: true });
    expect(describeRows(rows)).toEqual(['0:banks', '1:ge', '2:tb', '3:acc-2', '1:acc-1', '0:cash']);
  });

  it('hides an expanded child while its parent is collapsed', () => {
    const rows = listTreeRows({
      items,
      isExpanded: ({ id }) => id === 'ge',
      includeAccounts: true,
    });
    expect(describeRows(rows)).toEqual(['0:banks', '0:cash']);
  });

  it('tags account rows with the group they belong to', () => {
    const rows = listTreeRows({ items, isExpanded: () => true, includeAccounts: true });
    const accountGroups = rows.flatMap((row) => (row.type === 'account' ? [[row.account.id, row.groupId]] : []));
    expect(accountGroups).toEqual([
      ['acc-2', 'tb'],
      ['acc-1', 'banks'],
    ]);
  });
});
