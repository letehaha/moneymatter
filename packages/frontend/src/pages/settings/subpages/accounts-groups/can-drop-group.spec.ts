import { describe, expect, it } from 'vitest';

import { groupDropError } from './can-drop-group';
import { makeGroup } from './test-fixtures';

const grandchild = makeGroup({ id: 'grandchild', parentGroupId: 'child' });
const child = makeGroup({
  id: 'child',
  parentGroupId: 'root',
  childGroups: [grandchild],
});
const root = makeGroup({ id: 'root', childGroups: [child] });
const other = makeGroup({ id: 'other' });
const bank = makeGroup({ id: 'bank', bankDataProviderConnectionId: 'conn-1' });

describe('groupDropError', () => {
  it('allows nesting under an unrelated group', () => {
    expect(groupDropError({ dragged: child, target: other })).toBeNull();
  });

  it('rejects dropping a group onto itself', () => {
    expect(groupDropError({ dragged: root, target: root })).toBe('self');
  });

  it('rejects dropping onto the current parent', () => {
    expect(groupDropError({ dragged: child, target: root })).toBe('current-parent');
  });

  it('rejects dropping a group into its own descendant', () => {
    expect(groupDropError({ dragged: root, target: child })).toBe('inside-itself');
    expect(groupDropError({ dragged: root, target: grandchild })).toBe('inside-itself');
  });

  it('allows bank-synced groups as targets and as dragged groups', () => {
    expect(groupDropError({ dragged: other, target: bank })).toBeNull();
    expect(groupDropError({ dragged: bank, target: other })).toBeNull();
  });

  it('allows the top-level zone only for nested groups', () => {
    expect(groupDropError({ dragged: child, target: null })).toBeNull();
    expect(groupDropError({ dragged: root, target: null })).toBe('already-top-level');
  });
});
