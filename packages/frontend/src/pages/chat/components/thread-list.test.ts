import { createChatI18n } from '@/components/chat/cards/card-test-fixtures';
import { useChatThreadList, useDeleteChatThread, useUpdateChatThread } from '@/composable/data-queries/chat';
import type { ChatThreadSearchHit } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MaybeRefOrGetter, computed, defineComponent, h, ref, toValue } from 'vue';

import ThreadList from './thread-list.vue';

vi.mock('@/composable/data-queries/chat', () => ({
  useChatThreadList: vi.fn(),
  useUpdateChatThread: vi.fn(),
  useDeleteChatThread: vi.fn(),
}));
const addSuccessNotification = vi.fn();
vi.mock('@/components/notification-center', () => ({
  NotificationType: { error: 'error' },
  useNotificationCenter: () => ({ addSuccessNotification, addErrorNotification: vi.fn(), addNotification: vi.fn() }),
}));
vi.mock('@/components/common/responsive-alert-dialog.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue');
  return {
    default: define({
      props: { open: Boolean, confirmVariant: String, confirmLabel: String },
      emits: ['update:open', 'confirm'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? render('div', { 'data-testid': 'alert-dialog', 'data-variant': props.confirmVariant }, [
                render('div', { 'data-testid': 'alert-title' }, slots.title?.()),
                render('div', { 'data-testid': 'alert-description' }, slots.description?.()),
                render(
                  'button',
                  { 'data-testid': 'alert-confirm', onClick: () => emit('confirm') },
                  props.confirmLabel,
                ),
              ])
            : null,
    }),
  };
});

const hit = (overrides: Partial<ChatThreadSearchHit> & { id: string }): ChatThreadSearchHit => ({
  title: overrides.id,
  titleSource: 'auto',
  pinned: false,
  lastMessageAt: '2026-03-05T10:00:00.000Z',
  expiresAt: null,
  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  connectionId: null,
  modelId: null,
  pageContext: null,
  pageContextNames: {},
  createdAt: '2026-03-05T10:00:00.000Z',
  ...overrides,
});

const state = {
  threads: ref<ChatThreadSearchHit[]>([]),
  isLoading: ref(false),
  isError: ref(false),
  hasNextPage: ref(false),
};
const fetchNextPage = vi.fn();
const refetch = vi.fn();
const update = vi.fn();
const remove = vi.fn();
let searchSource: MaybeRefOrGetter<string> | undefined;

const mountList = ({ activeThreadId = null }: { activeThreadId?: string | null } = {}) =>
  mount(ThreadList, {
    props: { activeThreadId },
    global: {
      plugins: [createChatI18n()],
      stubs: {
        // The row is covered by its own suite; here it only reports what the list wires up.
        ThreadListItem: defineComponent({
          props: ['thread', 'active'],
          emits: ['select', 'rename', 'toggle-pin', 'delete'],
          setup:
            (props, { emit }) =>
            () =>
              h('div', { 'data-testid': 'item', 'data-id': props.thread.id, 'data-active': String(props.active) }, [
                h('button', { 'data-testid': `select-${props.thread.id}`, onClick: () => emit('select') }),
                h('button', { 'data-testid': `rename-${props.thread.id}`, onClick: () => emit('rename', 'New name') }),
                h('button', { 'data-testid': `pin-${props.thread.id}`, onClick: () => emit('toggle-pin') }),
                h('button', { 'data-testid': `delete-${props.thread.id}`, onClick: () => emit('delete') }),
              ]),
        }),
      },
    },
  });

describe('ThreadList', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const mock of [fetchNextPage, refetch, update, remove, addSuccessNotification]) mock.mockReset();
    update.mockResolvedValue({});
    remove.mockResolvedValue(undefined);
    state.threads.value = [];
    state.isLoading.value = false;
    state.isError.value = false;
    state.hasNextPage.value = false;
    searchSource = undefined;

    vi.mocked(useChatThreadList).mockImplementation(({ search } = {}) => {
      searchSource = search;
      return {
        threads: computed(() => state.threads.value),
        isLoading: state.isLoading,
        isError: state.isError,
        hasNextPage: state.hasNextPage,
        isFetchingNextPage: ref(false),
        fetchNextPage,
        refetch,
      } as unknown as ReturnType<typeof useChatThreadList>;
    });
    vi.mocked(useUpdateChatThread).mockReturnValue({ mutateAsync: update } as unknown as ReturnType<
      typeof useUpdateChatThread
    >);
    vi.mocked(useDeleteChatThread).mockReturnValue({ mutateAsync: remove } as unknown as ReturnType<
      typeof useDeleteChatThread
    >);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ids = ({ wrapper }: { wrapper: ReturnType<typeof mountList> }) =>
    wrapper.findAll('[data-testid="item"]').map((item) => item.attributes('data-id'));

  it('lists pinned threads first under their own heading', () => {
    state.threads.value = [hit({ id: 'a' }), hit({ id: 'b', pinned: true }), hit({ id: 'c' })];

    const wrapper = mountList();

    expect(ids({ wrapper })).toEqual(['b', 'a', 'c']);
    expect(wrapper.findAll('[data-testid="group-heading"]').map((heading) => heading.text())).toEqual([
      'Pinned',
      'Recent',
    ]);
  });

  it('marks the open thread', () => {
    state.threads.value = [hit({ id: 'a' }), hit({ id: 'b' })];

    const wrapper = mountList({ activeThreadId: 'b' });

    expect(wrapper.findAll('[data-testid="item"]').map((item) => item.attributes('data-active'))).toEqual([
      'false',
      'true',
    ]);
  });

  it('opens a thread', async () => {
    state.threads.value = [hit({ id: 'a' })];
    const wrapper = mountList();

    await wrapper.find('[data-testid="select-a"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([['a']]);
  });

  it('starts a new chat', async () => {
    const wrapper = mountList();

    await wrapper.find('[data-testid="new-chat"]').trigger('click');

    expect(wrapper.emitted('new-chat')).toHaveLength(1);
  });

  describe('search', () => {
    it('searches after the typing pauses', async () => {
      const wrapper = mountList();

      await wrapper.find('input').setValue('coff');
      await wrapper.find('input').setValue('coffee');

      expect(toValue(searchSource)).toBe('');

      vi.advanceTimersByTime(300);
      await flushPromises();

      expect(toValue(searchSource)).toBe('coffee');
    });

    it('lists search hits as one group', async () => {
      state.threads.value = [hit({ id: 'a', pinned: true }), hit({ id: 'b' })];
      const wrapper = mountList();
      await wrapper.find('input').setValue('coffee');
      vi.advanceTimersByTime(300);
      await flushPromises();

      expect(wrapper.findAll('[data-testid="group-heading"]').map((heading) => heading.text())).toEqual(['Results']);
    });

    it('says when nothing matches', async () => {
      const wrapper = mountList();
      await wrapper.find('input').setValue('coffee');
      vi.advanceTimersByTime(300);
      await flushPromises();

      expect(wrapper.text()).toContain('Nothing found for “coffee”.');
    });
  });

  describe('states', () => {
    it('shows skeletons while loading', () => {
      state.isLoading.value = true;

      expect(mountList().find('[data-testid="threads-skeleton"]').exists()).toBe(true);
    });

    it('invites the first question when there are no threads', () => {
      expect(mountList().text()).toContain('No conversations yet');
    });

    it('offers a retry when the list cannot be read', async () => {
      state.isError.value = true;
      const wrapper = mountList();

      await wrapper.find('[data-testid="retry"]').trigger('click');

      expect(refetch).toHaveBeenCalled();
    });

    it('loads the next page on request', async () => {
      state.threads.value = [hit({ id: 'a' })];
      state.hasNextPage.value = true;
      const wrapper = mountList();

      await wrapper.find('[data-testid="load-more"]').trigger('click');

      expect(fetchNextPage).toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    it('renames a thread and says so', async () => {
      state.threads.value = [hit({ id: 'a' })];
      const wrapper = mountList();

      await wrapper.find('[data-testid="rename-a"]').trigger('click');
      await flushPromises();

      expect(update).toHaveBeenCalledWith({ threadId: 'a', payload: { title: 'New name' } });
      expect(addSuccessNotification).toHaveBeenCalledWith('Conversation renamed');
    });

    it('pins an unpinned thread and unpins a pinned one', async () => {
      state.threads.value = [hit({ id: 'a' }), hit({ id: 'b', pinned: true })];
      const wrapper = mountList();

      await wrapper.find('[data-testid="pin-a"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="pin-b"]').trigger('click');
      await flushPromises();

      expect(update).toHaveBeenNthCalledWith(1, { threadId: 'a', payload: { pinned: true } });
      expect(update).toHaveBeenNthCalledWith(2, { threadId: 'b', payload: { pinned: false } });
      expect(addSuccessNotification).toHaveBeenNthCalledWith(1, 'Conversation pinned');
      expect(addSuccessNotification).toHaveBeenNthCalledWith(2, 'Conversation unpinned');
    });

    it('asks before deleting and names the conversation', async () => {
      state.threads.value = [hit({ id: 'a', title: 'Grocery spending' })];
      const wrapper = mountList();

      await wrapper.find('[data-testid="delete-a"]').trigger('click');

      expect(remove).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="alert-dialog"]').attributes('data-variant')).toBe('destructive');
      expect(wrapper.find('[data-testid="alert-title"]').text()).toBe('Delete this conversation?');
    });

    it('deletes after the confirmation, says so, and reports the thread that is gone', async () => {
      state.threads.value = [hit({ id: 'a' })];
      const wrapper = mountList({ activeThreadId: 'a' });
      await wrapper.find('[data-testid="delete-a"]').trigger('click');

      await wrapper.find('[data-testid="alert-confirm"]').trigger('click');
      await flushPromises();

      expect(remove).toHaveBeenCalledWith({ threadId: 'a' });
      expect(addSuccessNotification).toHaveBeenCalledWith('Conversation deleted');
      expect(wrapper.emitted('deleted')).toEqual([['a']]);
      expect(wrapper.find('[data-testid="alert-dialog"]').exists()).toBe(false);
    });
  });
});
