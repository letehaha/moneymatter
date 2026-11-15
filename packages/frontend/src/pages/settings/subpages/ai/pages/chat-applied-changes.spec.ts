import { buildCard } from '@/components/chat/cards/card-test-fixtures';
import { useChatAppliedCards } from '@/composable/data-queries/chat';
import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import enAi from '@/i18n/locales/chunks/en/settings/ai.json';
import { ROUTES_NAMES } from '@/routes/constants';
import type { ChatAppliedChange } from '@bt/shared/types';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import ChatAppliedChanges from './chat-applied-changes.vue';

vi.mock('@/composable/data-queries/chat', () => ({ useChatAppliedCards: vi.fn() }));

const fetchNextPage = vi.fn();
const refetch = vi.fn();
const state = {
  items: ref<ChatAppliedChange[]>([]),
  isLoading: ref(false),
  isError: ref(false),
  hasNextPage: ref(false),
};

const applied = ({
  id,
  threadId = 't1',
  threadTitle = 'Groceries',
}: {
  id: string;
  threadId?: string;
  threadTitle?: string;
}) =>
  ({
    threadId,
    threadTitle,
    card: buildCard({
      id,
      status: 'applied',
      title: { key: 'chat.cards.title.create', params: { entity: 'tag' } },
      result: { refs: [], executedArgs: {}, appliedAt: '2026-03-05T10:00:00.000Z' },
    }),
  }) satisfies ChatAppliedChange;

const mountPage = () =>
  mount(ChatAppliedChanges, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale: 'en', messages: { en: { ...enAi, ...enChat } }, missingWarn: false }),
      ],
      stubs: { RouterLink: RouterLinkStub },
    },
  });

describe('ChatAppliedChanges', () => {
  beforeEach(() => {
    fetchNextPage.mockReset();
    refetch.mockReset();
    state.items.value = [];
    state.isLoading.value = false;
    state.isError.value = false;
    state.hasNextPage.value = false;
    vi.mocked(useChatAppliedCards).mockReturnValue({
      data: computed(() => ({ pages: [{ items: state.items.value, nextCursor: null }] })),
      isLoading: state.isLoading,
      isError: state.isError,
      hasNextPage: state.hasNextPage,
      isFetchingNextPage: ref(false),
      fetchNextPage,
      refetch,
    } as unknown as ReturnType<typeof useChatAppliedCards>);
  });

  it('lists each applied change with its title and the time', () => {
    state.items.value = [applied({ id: 'c1' }), applied({ id: 'c2' })];

    const rows = mountPage().findAll('[data-testid="applied-change"]');

    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('Create tag');
    expect(rows[0]!.text()).toContain('Applied');
  });

  it('links each change to its conversation', () => {
    state.items.value = [applied({ id: 'c1', threadId: 'thread-9', threadTitle: 'Groceries' })];

    const wrapper = mountPage();
    const link = wrapper.findAllComponents(RouterLinkStub).at(-1)!;

    expect(link.props('to')).toEqual({ name: ROUTES_NAMES.chatThread, params: { threadId: 'thread-9' } });
    expect(wrapper.text()).toContain('Groceries');
  });

  it('says what the list is when nothing was applied', () => {
    expect(mountPage().text()).toContain('Nothing applied yet');
  });

  it('shows skeletons while loading', () => {
    state.isLoading.value = true;

    expect(mountPage().find('[data-testid="applied-skeleton"]').exists()).toBe(true);
  });

  it('offers a retry when the list cannot be read', async () => {
    state.isError.value = true;
    const wrapper = mountPage();

    await wrapper.find('[data-testid="retry"]').trigger('click');

    expect(refetch).toHaveBeenCalled();
  });

  it('loads more on request', async () => {
    state.items.value = [applied({ id: 'c1' })];
    state.hasNextPage.value = true;
    const wrapper = mountPage();

    await wrapper.find('[data-testid="load-more"]').trigger('click');

    expect(fetchNextPage).toHaveBeenCalled();
  });
});
