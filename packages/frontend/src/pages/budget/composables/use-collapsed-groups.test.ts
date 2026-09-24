import { nextTick, ref } from 'vue';

import { useCollapsedGroups } from './use-collapsed-groups';

const storageKey = ({ planId }: { planId: string }) => `budget-plan:${planId}:collapsed-groups`;

describe('useCollapsedGroups', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds and removes ids via setCollapsed and toggleGroup, persisting them', async () => {
    const { collapsedIds, setCollapsed, toggleGroup } = useCollapsedGroups({ planId: 'p1' });

    setCollapsed({ groupIds: ['a', 'b'], collapsed: true });
    await nextTick();
    expect([...collapsedIds.value]).toEqual(['a', 'b']);
    expect(JSON.parse(localStorage.getItem(storageKey({ planId: 'p1' }))!)).toEqual(['a', 'b']);

    toggleGroup({ groupId: 'a' });
    toggleGroup({ groupId: 'c' });
    expect([...collapsedIds.value]).toEqual(['b', 'c']);

    setCollapsed({ groupIds: ['b', 'c'], collapsed: false });
    expect(collapsedIds.value.size).toBe(0);
  });

  it('scopes collapsed ids per plan id', async () => {
    localStorage.setItem(storageKey({ planId: 'p2' }), JSON.stringify(['x']));
    const planId = ref('p1');
    const { collapsedIds, setCollapsed } = useCollapsedGroups({ planId });

    setCollapsed({ groupIds: ['a'], collapsed: true });
    await nextTick();

    planId.value = 'p2';
    await nextTick();
    expect([...collapsedIds.value]).toEqual(['x']);

    planId.value = 'p1';
    await nextTick();
    expect([...collapsedIds.value]).toEqual(['a']);
  });

  it.each([['{"a":1}'], ['42'], ['not json']])('does not crash on a garbage stored value %s', (raw) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(storageKey({ planId: 'p1' }), raw);

    const { collapsedIds, toggleGroup } = useCollapsedGroups({ planId: 'p1' });
    expect(collapsedIds.value.size).toBe(0);

    toggleGroup({ groupId: 'a' });
    expect([...collapsedIds.value]).toEqual(['a']);
  });
});
