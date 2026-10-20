import type { AccountGroups } from '@/common/types/models';
import type { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { collectManualAccounts, mapFolderGroupNames, pruneBankLinkedAccounts } from './manual-accounts-split';

const makeAccount = ({ id, connectionId = null }: { id: string; connectionId?: string | null }): AccountModel =>
  ({ id, bankDataProviderConnectionId: connectionId ?? undefined }) as unknown as AccountModel;

const makeGroup = ({
  id,
  name = id,
  connectionId = null,
  accounts = [],
  childGroups = [],
}: {
  id: string;
  name?: string;
  connectionId?: string | null;
  accounts?: AccountModel[];
  childGroups?: AccountGroups[];
}): AccountGroups =>
  ({ id, name, bankDataProviderConnectionId: connectionId, accounts, childGroups }) as unknown as AccountGroups;

describe('pruneBankLinkedAccounts', () => {
  it('keeps manual accounts and strips bank-linked ones', () => {
    const groups = [
      makeGroup({
        id: 'g1',
        accounts: [makeAccount({ id: 'manual' }), makeAccount({ id: 'bank', connectionId: 'conn-1' })],
      }),
    ];

    const pruned = pruneBankLinkedAccounts({ groups });

    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.accounts.map((a) => a.id)).toEqual(['manual']);
  });

  it('drops a group whose accounts are all bank-linked', () => {
    const groups = [makeGroup({ id: 'g1', accounts: [makeAccount({ id: 'bank', connectionId: 'conn-1' })] })];

    expect(pruneBankLinkedAccounts({ groups })).toEqual([]);
  });

  it('prunes recursively and keeps a parent whose only content is a surviving child', () => {
    const groups = [
      makeGroup({
        id: 'parent',
        accounts: [makeAccount({ id: 'bank-p', connectionId: 'conn-1' })],
        childGroups: [
          makeGroup({ id: 'child-kept', accounts: [makeAccount({ id: 'manual-c' })] }),
          makeGroup({ id: 'child-dropped', accounts: [makeAccount({ id: 'bank-c', connectionId: 'conn-1' })] }),
        ],
      }),
    ];

    const pruned = pruneBankLinkedAccounts({ groups });

    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.accounts).toEqual([]);
    expect(pruned[0]!.childGroups.map((g) => g.id)).toEqual(['child-kept']);
  });

  it('does not mutate the input tree', () => {
    const group = makeGroup({
      id: 'g1',
      accounts: [makeAccount({ id: 'manual' }), makeAccount({ id: 'bank', connectionId: 'conn-1' })],
    });

    pruneBankLinkedAccounts({ groups: [group] });

    expect(group.accounts).toHaveLength(2);
  });
});

describe('collectManualAccounts', () => {
  it('collects manual accounts across nesting and skips bank-linked ones', () => {
    const groups = [
      makeGroup({
        id: 'conn-group',
        connectionId: 'conn-1',
        accounts: [makeAccount({ id: 'bank', connectionId: 'conn-1' }), makeAccount({ id: 'manual-top' })],
        childGroups: [makeGroup({ id: 'nested', accounts: [makeAccount({ id: 'manual-nested' })] })],
      }),
    ];

    expect(collectManualAccounts({ groups }).map((a) => a.id)).toEqual(['manual-top', 'manual-nested']);
  });
});

describe('mapFolderGroupNames', () => {
  it('maps accounts to their direct folder group and skips connection groups', () => {
    const groups = [
      makeGroup({
        id: 'conn-group',
        name: 'Monobank',
        connectionId: 'conn-1',
        accounts: [makeAccount({ id: 'in-conn', connectionId: 'conn-1' })],
        childGroups: [
          makeGroup({
            id: 'folder',
            name: 'Credit cards',
            accounts: [makeAccount({ id: 'in-folder', connectionId: 'conn-1' })],
          }),
        ],
      }),
    ];

    expect(mapFolderGroupNames({ groups })).toEqual({ 'in-folder': 'Credit cards' });
  });
});
