import type { AccountGroups } from '@/common/types/models';
import { listAccountGroupPaths } from '@/components/sidebar/accounts-view/helpers/list-account-group-paths';
import { describe, expect, it } from 'vitest';

import { makeGroup } from '../test-fixtures';
import { listMoveTargets } from './move-target-options';

const ukraine = makeGroup({
  id: 'ukraine',
  parentGroupId: 'personal',
  childGroups: [makeGroup({ id: 'kyiv', parentGroupId: 'ukraine' })],
});
const personal = makeGroup({ id: 'personal', childGroups: [ukraine] });
const work = makeGroup({ id: 'work' });
const bank = makeGroup({ id: 'bank', bankDataProviderConnectionId: 'conn-1' });

const entries = listAccountGroupPaths({ groups: [personal, work, bank] });
const targetIds = ({ group }: { group: AccountGroups }) =>
  listMoveTargets({ group, entries }).map((entry) => entry.group.id);

describe('listMoveTargets', () => {
  it('excludes the group itself and its whole subtree', () => {
    expect(targetIds({ group: personal })).toEqual(['work', 'bank']);
  });

  it('keeps the current parent, other ancestors and siblings of a nested group', () => {
    expect(targetIds({ group: ukraine })).toEqual(['personal', 'work', 'bank']);
  });

  it('offers a bank-synced group as a parent', () => {
    expect(targetIds({ group: work })).toContain('bank');
  });

  it('resolves the subtree from the tree when given a stub without nested children', () => {
    const stub = makeGroup({ id: 'personal', childGroups: [makeGroup({ id: 'ukraine' })] });

    expect(targetIds({ group: stub })).toEqual(['work', 'bank']);
  });

  it('labels targets with their full path', () => {
    expect(listMoveTargets({ group: work, entries }).map((entry) => entry.path)).toEqual([
      'personal',
      'personal / ukraine',
      'personal / ukraine / kyiv',
      'bank',
    ]);
  });
});
