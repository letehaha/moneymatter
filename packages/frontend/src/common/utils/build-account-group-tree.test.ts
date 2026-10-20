import type { AccountGroups } from '@/common/types/models';
import { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildAccountGroupTree } from './build-account-group-tree';

const makeGroup = ({
  id,
  parentGroupId = null,
  accountIds = [],
  childGroups = [],
}: {
  id: string;
  parentGroupId?: string | null;
  accountIds?: string[];
  childGroups?: AccountGroups[];
}) =>
  ({
    id,
    name: id,
    parentGroupId,
    accounts: accountIds.map((accountId) => ({ id: accountId }) as AccountModel),
    childGroups,
  }) as unknown as AccountGroups;

const stub = (group: AccountGroups) => ({ ...group, accounts: [], childGroups: [] });

describe('buildAccountGroupTree', () => {
  it('returns only roots, with hydrated children and grandchildren nested', () => {
    const leaf = makeGroup({ id: 'leaf', parentGroupId: 'mid', accountIds: ['l1'] });
    const mid = makeGroup({ id: 'mid', parentGroupId: 'root', accountIds: ['m1'], childGroups: [stub(leaf)] });
    const root = makeGroup({ id: 'root', childGroups: [stub(mid)] });

    const tree = buildAccountGroupTree({ groups: [root, mid, leaf] });

    expect(tree.map((group) => group.id)).toEqual(['root']);
    expect(tree[0]!.childGroups[0]!.accounts.map((account) => account.id)).toEqual(['m1']);
    expect(tree[0]!.childGroups[0]!.childGroups[0]!.accounts.map((account) => account.id)).toEqual(['l1']);
  });

  it('keeps a group whose parent is missing as a root', () => {
    const tree = buildAccountGroupTree({ groups: [makeGroup({ id: 'orphan', parentGroupId: 'gone' })] });

    expect(tree.map((group) => group.id)).toEqual(['orphan']);
  });

  it('surfaces parent-cycle members exactly once', () => {
    const tree = buildAccountGroupTree({
      groups: [
        makeGroup({ id: 'a', parentGroupId: 'b' }),
        makeGroup({ id: 'b', parentGroupId: 'a' }),
        makeGroup({ id: 'self', parentGroupId: 'self' }),
      ],
    });
    const ids: string[] = [];
    const walk = ({ groups }: { groups: AccountGroups[] }) =>
      groups.forEach((group) => {
        ids.push(group.id);
        walk({ groups: group.childGroups });
      });
    walk({ groups: tree });

    expect(ids.sort()).toEqual(['a', 'b', 'self']);
  });
});
