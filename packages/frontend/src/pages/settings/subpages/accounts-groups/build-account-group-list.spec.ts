import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/common/utils/build-account-group-tree';
import { describe, expect, it } from 'vitest';

import { buildAccountGroupList } from './build-account-group-list';

const makeGroup = ({ id, name, parentGroupId = null }: { id: string; name: string; parentGroupId?: string | null }) =>
  ({ id, name, parentGroupId, accounts: [], childGroups: [] }) as unknown as AccountGroups;

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
