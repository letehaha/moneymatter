import { loadCategoriesByAccount } from '@/api/categories';
import { useNotificationCenter } from '@/components/notification-center';
import { CATEGORY_TYPES, type CategoryModel, type RecordId } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import { useAccountCategories } from './categories';

vi.mock('@/api/categories', () => ({
  loadCategoriesByAccount: vi.fn(),
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: vi.fn(),
}));

vi.mock('@/stores/categories/helpers', () => ({
  buildCategoriesObjectGraph: vi.fn((list: CategoryModel[]) => list),
}));

const mockLoadCategoriesByAccount = vi.mocked(loadCategoriesByAccount);
const mockUseNotificationCenter = vi.mocked(useNotificationCenter);

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: {} },
});

const MOCK_CATEGORIES: CategoryModel[] = [
  {
    id: '00000000-0000-0000-0000-000000000001' as RecordId,
    key: null,
    name: 'Food',
    icon: null,
    color: '#e74c3c',
    type: CATEGORY_TYPES.custom,
    parentId: null,
    userId: 42,
    defaultTagIds: [],
    applyDefaultTagsOnAiCategorization: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000002' as RecordId,
    key: null,
    name: 'Transport',
    icon: null,
    color: '#3498db',
    type: CATEGORY_TYPES.custom,
    parentId: null,
    userId: 42,
    defaultTagIds: [],
    applyDefaultTagsOnAiCategorization: false,
  },
];

const setup = ({
  accountId,
  enabled,
}: {
  accountId?: string | undefined;
  enabled?: boolean;
} = {}) => {
  const addErrorNotification = vi.fn();
  mockUseNotificationCenter.mockReturnValue({
    addErrorNotification,
  } as unknown as ReturnType<typeof useNotificationCenter>);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let result: ReturnType<typeof useAccountCategories> | undefined;

  const TestComponent = defineComponent({
    setup() {
      result = useAccountCategories({
        accountId: ref(accountId),
        ...(enabled !== undefined && { enabled: ref(enabled) }),
      });
      return {};
    },
    template: '<div />',
  });

  mount(TestComponent, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient }], i18n],
    },
  });

  return { queryClient, addErrorNotification, getResult: () => result! };
};

describe('useAccountCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on success', () => {
    it('calls loadCategoriesByAccount with the given accountId', async () => {
      mockLoadCategoriesByAccount.mockResolvedValue(MOCK_CATEGORIES);

      setup({ accountId: '00000000-0000-0000-0000-000000000010' });

      await vi.waitFor(() => {
        expect(mockLoadCategoriesByAccount).toHaveBeenCalledWith({ accountId: '00000000-0000-0000-0000-000000000010' });
      });
    });

    it('exposes fetched categories via query.data', async () => {
      mockLoadCategoriesByAccount.mockResolvedValue(MOCK_CATEGORIES);

      const { getResult } = setup({ accountId: '00000000-0000-0000-0000-000000000010' });

      await vi.waitFor(() => {
        expect(getResult().isSuccess.value).toBe(true);
      });

      expect(getResult().data.value).toEqual(MOCK_CATEGORIES);
    });

    it('does not call addErrorNotification on success', async () => {
      mockLoadCategoriesByAccount.mockResolvedValue(MOCK_CATEGORIES);

      const { addErrorNotification, getResult } = setup({ accountId: '00000000-0000-0000-0000-000000000010' });

      await vi.waitFor(() => {
        expect(getResult().isSuccess.value).toBe(true);
      });

      expect(addErrorNotification).not.toHaveBeenCalled();
    });
  });

  describe('on error', () => {
    it('sets isError to true when the API call fails', async () => {
      mockLoadCategoriesByAccount.mockRejectedValue(new Error('Network error'));

      const { getResult } = setup({ accountId: '00000000-0000-0000-0000-000000000010' });

      await vi.waitFor(() => {
        expect(getResult().isError.value).toBe(true);
      });
    });

    it('calls addErrorNotification exactly once when the API call fails', async () => {
      mockLoadCategoriesByAccount.mockRejectedValue(new Error('Network error'));

      const { addErrorNotification, getResult } = setup({ accountId: '00000000-0000-0000-0000-000000000010' });

      await vi.waitFor(() => {
        expect(getResult().isError.value).toBe(true);
      });

      expect(addErrorNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled flag', () => {
    it('does not fetch when accountId is undefined', async () => {
      mockLoadCategoriesByAccount.mockResolvedValue(MOCK_CATEGORIES);

      setup({ accountId: undefined });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLoadCategoriesByAccount).not.toHaveBeenCalled();
    });

    it('does not fetch when enabled is false', async () => {
      mockLoadCategoriesByAccount.mockResolvedValue(MOCK_CATEGORIES);

      setup({ accountId: '00000000-0000-0000-0000-000000000010', enabled: false });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLoadCategoriesByAccount).not.toHaveBeenCalled();
    });
  });
});
