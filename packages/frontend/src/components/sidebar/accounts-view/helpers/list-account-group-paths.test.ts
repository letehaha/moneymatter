import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/common/utils/build-account-group-tree';
import { describe, expect, it } from 'vitest';

import { listAccountGroupPaths } from './list-account-group-paths';

const makeGroup = ({ id, name, parentGroupId = null }: { id: string; name: string; parentGroupId?: string | null }) =>
  ({ id, name, parentGroupId, accounts: [], childGroups: [] }) as unknown as AccountGroups;

describe('listAccountGroupPaths', () => {
  it('lists depth-first and labels same-named subgroups with their parent', () => {
    const tree = buildAccountGroupTree({
      groups: [
        makeGroup({ id: 'bank-indonesia', name: 'Indonesia', parentGroupId: 'banks' }),
        makeGroup({ id: 'banks', name: 'Banks' }),
        makeGroup({ id: 'wallet-indonesia', name: 'Indonesia', parentGroupId: 'e-wallets' }),
        makeGroup({ id: 'e-wallets', name: 'E-wallets' }),
      ],
    });

    expect(listAccountGroupPaths({ groups: tree }).map((entry) => entry.path)).toEqual([
      'Banks',
      'Banks / Indonesia',
      'E-wallets',
      'E-wallets / Indonesia',
    ]);
  });
});
