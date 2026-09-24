import { useLocalStorage } from '@vueuse/core';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

export const useCollapsedGroups = ({ planId }: { planId: MaybeRefOrGetter<string> }) => {
  const stored = useLocalStorage<string[]>(() => `budget-plan:${toValue(planId)}:collapsed-groups`, []);
  const collapsedIds = computed(() => new Set(Array.isArray(stored.value) ? stored.value : []));

  const setCollapsed = ({ groupIds, collapsed }: { groupIds: string[]; collapsed: boolean }) => {
    const next = new Set(collapsedIds.value);
    for (const id of groupIds) {
      if (collapsed) next.add(id);
      else next.delete(id);
    }
    stored.value = [...next];
  };

  const toggleGroup = ({ groupId }: { groupId: string }) =>
    setCollapsed({ groupIds: [groupId], collapsed: !collapsedIds.value.has(groupId) });

  return { collapsedIds, setCollapsed, toggleGroup };
};
