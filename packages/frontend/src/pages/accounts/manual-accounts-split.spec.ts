import type { AccountGroups } from '@/common/types/models';
import { collectGroupAccounts } from '@/components/sidebar/accounts-view/helpers/account-totals';
import type { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildManualFolderGroups,
  collectManualAccounts,
  mapFolderGroupNames,
  pruneBankLinkedAccounts,
} from './manual-accounts-split';

const makeAccount = ({ id, connectionId = null }: { id: string; connectionId?: string | null }): AccountModel =>
  ({ id, bankDataProviderConnectionId: connectionId ?? undefined }) as unknown as AccountModel;

const makeGroup = ({
  id,
  name = id,
  connectionId = null,
  parentGroupId = null,
  accounts = [],
  childGroups = [],
}: {
  id: string;
  name?: string;
  connectionId?: string | null;
  parentGroupId?: string | null;
  accounts?: AccountModel[];
  childGroups?: AccountGroups[];
}): AccountGroups =>
  ({
    id,
    name,
    parentGroupId,
    bankDataProviderConnectionId: connectionId,
    accounts,
    childGroups,
  }) as unknown as AccountGroups;

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

describe('buildManualFolderGroups', () => {
  // The API returns every group in one flat list; nested `childGroups` entries carry no accounts.
  const ownerApiResponse = (): AccountGroups[] => {
    const subgroups = ['georgia', 'bank-indonesia', 'kazakhstan', 'russia', 'vietnam'].map((id) =>
      makeGroup({ id, name: id, parentGroupId: 'banks', accounts: [makeAccount({ id: `${id}-acc` })] }),
    );
    const walletIndonesia = makeGroup({
      id: 'wallet-indonesia',
      name: 'Indonesia',
      parentGroupId: 'wallets',
      accounts: [makeAccount({ id: 'wallet-indonesia-acc' })],
    });
    const stub = (group: AccountGroups): AccountGroups => ({ ...group, accounts: [], childGroups: [] });

    return [
      makeGroup({
        id: 'banks',
        name: 'Banks',
        accounts: [makeAccount({ id: 'bitfree' })],
        childGroups: subgroups.map(stub),
      }),
      ...subgroups,
      makeGroup({
        id: 'wallets',
        name: 'E-wallets',
        accounts: [makeAccount({ id: 'moreta-pay' })],
        childGroups: [stub(walletIndonesia)],
      }),
      walletIndonesia,
      makeGroup({ id: 'cash', name: 'Cash', accounts: [makeAccount({ id: 'cash-acc' })] }),
      makeGroup({ id: 'crypto', name: 'Crypto', accounts: [makeAccount({ id: 'crypto-acc' })] }),
    ];
  };

  it('returns only root groups, with subgroups nested under their parent', () => {
    const { folderGroups } = buildManualFolderGroups({ groups: ownerApiResponse() });

    expect(folderGroups.map((g) => g.name)).toEqual(['Banks', 'E-wallets', 'Cash', 'Crypto']);
    expect(folderGroups[0]!.childGroups.map((g) => g.id)).toEqual([
      'georgia',
      'bank-indonesia',
      'kazakhstan',
      'russia',
      'vietnam',
    ]);
    expect(folderGroups[1]!.childGroups.map((g) => g.id)).toEqual(['wallet-indonesia']);
  });

  it('counts the whole subtree for a parent group', () => {
    const { folderGroups } = buildManualFolderGroups({ groups: ownerApiResponse() });

    expect(collectGroupAccounts({ group: folderGroups[0]! })).toHaveLength(6);
    expect(collectGroupAccounts({ group: folderGroups[1]! })).toHaveLength(2);
  });

  it('keeps a bank-linked subgroup of a folder group out of the manual tree', () => {
    const groups = [
      makeGroup({ id: 'banks', childGroups: [makeGroup({ id: 'sub' })] }),
      makeGroup({
        id: 'sub',
        parentGroupId: 'banks',
        accounts: [makeAccount({ id: 'bank', connectionId: 'conn-1' }), makeAccount({ id: 'manual' })],
      }),
    ];

    const { folderGroups } = buildManualFolderGroups({ groups });

    expect(folderGroups.map((g) => g.id)).toEqual(['banks']);
    expect(folderGroups[0]!.childGroups[0]!.accounts.map((a) => a.id)).toEqual(['manual']);
  });

  it('rescues manual accounts from a connection-managed group, including its subgroups', () => {
    const groups = [
      makeGroup({
        id: 'conn',
        connectionId: 'conn-1',
        accounts: [makeAccount({ id: 'bank', connectionId: 'conn-1' }), makeAccount({ id: 'manual-top' })],
        childGroups: [makeGroup({ id: 'nested' })],
      }),
      makeGroup({ id: 'nested', parentGroupId: 'conn', accounts: [makeAccount({ id: 'manual-nested' })] }),
    ];

    const { folderGroups, rescuedAccounts } = buildManualFolderGroups({ groups });

    expect(folderGroups).toEqual([]);
    expect(rescuedAccounts.map((a) => a.id)).toEqual(['manual-top', 'manual-nested']);
  });
});
