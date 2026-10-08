import { CATEGORY_TYPES, type CategoryModel, type RecordId } from '@bt/shared/types';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

// idb-keyval backed by an in-memory Map so the persisted snapshot survives a simulated
// cache eviction without a real IndexedDB.
const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));

vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (key: string) => memory.get(key),
  set: async (key: string, value: string) => {
    memory.set(key, value);
  },
  del: async (key: string) => {
    memory.delete(key);
  },
  clear: async () => {
    memory.clear();
  },
  entries: async () => [...memory.entries()],
}));

const { mockLoadSystemCategories } = vi.hoisted(() => ({ mockLoadSystemCategories: vi.fn() }));

vi.mock('@/api', () => ({ loadSystemCategories: mockLoadSystemCategories }));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: vi.fn() }),
}));

vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }));

vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ user: ref({ id: 42 }) }),
}));

const flushScheduler = () => new Promise((resolve) => setTimeout(resolve, 0));

const category = ({ id, name }: { id: string; name: string }): CategoryModel => ({
  id: id as RecordId,
  key: null,
  name,
  icon: null,
  color: '#e74c3c',
  type: CATEGORY_TYPES.custom,
  parentId: null,
  userId: 42,
  defaultTagIds: [],
  applyDefaultTagsOnAiCategorization: false,
});

const FOOD = category({ id: '00000000-0000-0000-0000-000000000001', name: 'Food' });
const GROCERIES = category({ id: '00000000-0000-0000-0000-000000000002', name: 'Groceries' });

let useCategoriesStore: typeof import('./categories').useCategoriesStore;
let queryClient: typeof import('@/lib/query-client').queryClient;
let CATEGORIES_LIST_KEY: typeof import('@/common/const').VUE_QUERY_CACHE_KEYS.categoriesList;

beforeAll(async () => {
  // jsdom ships no IndexedDB; presence is all the persister's availability guard checks.
  vi.stubGlobal('indexedDB', {});
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0));

  ({ useCategoriesStore } = await import('./categories'));
  ({ queryClient } = await import('@/lib/query-client'));
  ({
    VUE_QUERY_CACHE_KEYS: { categoriesList: CATEGORIES_LIST_KEY },
  } = await import('@/common/const'));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  memory.clear();
  queryClient.clear();
  mockLoadSystemCategories.mockReset();
  setActivePinia(createPinia());
});

describe('categories store – loadCategories({ force: true })', () => {
  it('reflects a newly created category', async () => {
    const store = useCategoriesStore();

    mockLoadSystemCategories.mockResolvedValue([FOOD]);
    await store.loadCategories();
    await flushScheduler();

    mockLoadSystemCategories.mockResolvedValue([FOOD, GROCERIES]);
    await store.loadCategories({ force: true });

    expect(store.categories).toEqual([FOOD, GROCERIES]);
  });

  it('reflects a newly created category after the query was garbage-collected', async () => {
    const store = useCategoriesStore();

    mockLoadSystemCategories.mockResolvedValue([FOOD]);
    await store.loadCategories();
    await flushScheduler();

    // Stands in for gcTime eviction: nothing observes `categoriesList`, so it leaves the
    // in-memory cache minutes after the last read and only the disk snapshot remains.
    queryClient.removeQueries({ queryKey: CATEGORIES_LIST_KEY });

    mockLoadSystemCategories.mockResolvedValue([FOOD, GROCERIES]);
    await store.loadCategories({ force: true });

    expect(store.categories).toEqual([FOOD, GROCERIES]);
  });

  it('reflects a renamed category after the query was garbage-collected', async () => {
    const store = useCategoriesStore();

    mockLoadSystemCategories.mockResolvedValue([FOOD, GROCERIES]);
    await store.loadCategories();
    await flushScheduler();

    queryClient.removeQueries({ queryKey: CATEGORIES_LIST_KEY });

    const renamed = { ...GROCERIES, name: 'Supermarket' };
    mockLoadSystemCategories.mockResolvedValue([FOOD, renamed]);
    await store.loadCategories({ force: true });

    expect(store.categories).toEqual([FOOD, renamed]);
  });

  it('reflects a deleted category after the query was garbage-collected', async () => {
    const store = useCategoriesStore();

    mockLoadSystemCategories.mockResolvedValue([FOOD, GROCERIES]);
    await store.loadCategories();
    await flushScheduler();

    queryClient.removeQueries({ queryKey: CATEGORIES_LIST_KEY });

    mockLoadSystemCategories.mockResolvedValue([FOOD]);
    await store.loadCategories({ force: true });

    expect(store.categories).toEqual([FOOD]);
  });

  it('reflects deleting the last remaining category', async () => {
    const store = useCategoriesStore();

    mockLoadSystemCategories.mockResolvedValue([FOOD]);
    await store.loadCategories();
    await flushScheduler();

    mockLoadSystemCategories.mockResolvedValue([]);
    await store.loadCategories({ force: true });

    expect(store.categories).toEqual([]);
  });
});
