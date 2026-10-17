import type { AccountGroups } from '@/common/types/models';
import { describe, expect, it } from 'vitest';

import { listAccountGroupPaths } from './list-account-group-paths';

const makeApiGroup = ({
  id,
  name,
  parentGroupId = null,
}: {
  id: string;
  name: string;
  parentGroupId?: string | null;
}) => ({ id, name, parentGroupId, accounts: [], childGroups: [] }) as unknown as AccountGroups;

// The API returns every group flat, in no particular order, and two parents can both own an "Indonesia".
const ownerGroups = (): AccountGroups[] => [
  makeApiGroup({ id: 'bank-indonesia', name: 'Indonesia', parentGroupId: 'banks' }),
  makeApiGroup({ id: 'crypto', name: 'Crypto' }),
  makeApiGroup({ id: 'wallet-indonesia', name: 'Indonesia', parentGroupId: 'e-wallets' }),
  makeApiGroup({ id: 'banks', name: 'Banks' }),
  makeApiGroup({ id: 'e-wallets', name: 'E-wallets' }),
  makeApiGroup({ id: 'georgia', name: 'Georgia', parentGroupId: 'banks' }),
];

describe('listAccountGroupPaths', () => {
  it('lists each parent directly followed by its subgroups', () => {
    const entries = listAccountGroupPaths({ groups: ownerGroups() });

    expect(entries.map((entry) => entry.group.id)).toEqual([
      'crypto',
      'banks',
      'bank-indonesia',
      'georgia',
      'e-wallets',
      'wallet-indonesia',
    ]);
  });

  it('labels subgroups with their parent so same-named groups stay distinguishable', () => {
    const paths = Object.fromEntries(
      listAccountGroupPaths({ groups: ownerGroups() }).map((entry) => [entry.group.id, entry.path]),
    );

    expect(paths['bank-indonesia']).toBe('Banks / Indonesia');
    expect(paths['wallet-indonesia']).toBe('E-wallets / Indonesia');
    expect(paths['banks']).toBe('Banks');
  });

  it('joins every ancestor for deeper nesting', () => {
    const entries = listAccountGroupPaths({
      groups: [
        makeApiGroup({ id: 'a', name: 'A' }),
        makeApiGroup({ id: 'b', name: 'B', parentGroupId: 'a' }),
        makeApiGroup({ id: 'c', name: 'C', parentGroupId: 'b' }),
      ],
    });

    expect(entries.map((entry) => entry.path)).toEqual(['A', 'A / B', 'A / B / C']);
  });
});
