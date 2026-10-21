import { createChatI18n } from '@/components/chat/cards/card-test-fixtures';
import { useChatThread } from '@/composable/data-queries/chat';
import { ROUTES_NAMES } from '@/routes/constants';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, reactive, ref } from 'vue';

import ChatPage from './index.vue';

const route = reactive<{ name: string; params: Record<string, string>; query: Record<string, unknown> }>({
  name: ROUTES_NAMES.chat,
  params: {},
  query: {},
});
const push = vi.fn();
const replace = vi.fn();
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push, replace }) }));
vi.mock('@/composable/data-queries/chat', () => ({ useChatThread: vi.fn() }));

const thread = ref<{ id: string; title: string; usage: object; expiresAt: string | null; pinned: boolean } | null>(
  null,
);

// Both reach into the API layer; their own suites cover them.
vi.mock('@/components/chat/chat-conversation.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue');
  return {
    default: define({
      props: ['threadId', 'context'],
      emits: ['thread-created'],
      setup:
        (props, { emit }) =>
        () =>
          render('div', {
            'data-testid': 'conversation',
            'data-thread': String(props.threadId),
            'data-context': JSON.stringify(props.context),
            onClick: () => emit('thread-created', 'created-1'),
          }),
    }),
  };
});
vi.mock('./components/thread-list.vue', async () => {
  const { defineComponent: define, h: render } = await import('vue');
  return {
    default: define({
      props: ['activeThreadId'],
      emits: ['select', 'new-chat', 'deleted'],
      setup:
        (props, { emit }) =>
        () =>
          render('div', { 'data-testid': 'thread-list', 'data-active': String(props.activeThreadId) }, [
            render('button', { 'data-testid': 'pick', onClick: () => emit('select', 'picked-1') }),
            render('button', { 'data-testid': 'new', onClick: () => emit('new-chat') }),
            render('button', { 'data-testid': 'gone', onClick: () => emit('deleted', 'picked-1') }),
          ]),
    }),
  };
});

const mountPage = () =>
  mount(ChatPage, {
    global: {
      plugins: [createChatI18n()],
      stubs: {
        ChatUsageChip: { template: '<span data-testid="usage" />' },
        DesktopOnlyTooltip: { template: '<div><slot /></div>' },
      },
    },
  });

describe('Chat page', () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    route.name = ROUTES_NAMES.chat;
    route.params = {};
    route.query = {};
    thread.value = null;
    vi.mocked(useChatThread).mockReturnValue({ thread: computed(() => thread.value) } as unknown as ReturnType<
      typeof useChatThread
    >);
  });

  it('shows the thread of the route in the conversation and the list', () => {
    route.name = ROUTES_NAMES.chatThread;
    route.params = { threadId: 'thread-1' };

    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="conversation"]').attributes('data-thread')).toBe('thread-1');
    expect(wrapper.find('[data-testid="thread-list"]').attributes('data-active')).toBe('thread-1');
  });

  it('starts empty on the plain Chat route', () => {
    expect(mountPage().find('[data-testid="conversation"]').attributes('data-thread')).toBe('null');
  });

  it('opens a picked thread', async () => {
    await mountPage().find('[data-testid="pick"]').trigger('click');

    expect(push).toHaveBeenCalledWith({ name: ROUTES_NAMES.chatThread, params: { threadId: 'picked-1' } });
  });

  it('goes to a new chat', async () => {
    route.name = ROUTES_NAMES.chatThread;
    route.params = { threadId: 'thread-1' };

    await mountPage().find('[data-testid="new"]').trigger('click');

    expect(push).toHaveBeenCalledWith({ name: ROUTES_NAMES.chat });
  });

  it('moves to the thread a first message created without adding a history entry', async () => {
    await mountPage().find('[data-testid="conversation"]').trigger('click');

    expect(replace).toHaveBeenCalledWith({ name: ROUTES_NAMES.chatThread, params: { threadId: 'created-1' } });
  });

  it('leaves a deleted thread when it is the open one', async () => {
    route.name = ROUTES_NAMES.chatThread;
    route.params = { threadId: 'picked-1' };

    await mountPage().find('[data-testid="gone"]').trigger('click');

    expect(replace).toHaveBeenCalledWith({ name: ROUTES_NAMES.chat });
  });

  it('stays on a thread that is not the deleted one', async () => {
    route.name = ROUTES_NAMES.chatThread;
    route.params = { threadId: 'other' };

    await mountPage().find('[data-testid="gone"]').trigger('click');

    expect(replace).not.toHaveBeenCalled();
  });

  it('hands the conversation the page context the mobile header button put in the route', () => {
    route.query = { context: JSON.stringify({ route: 'dashboard.account', entity: { kind: 'account', id: 'a1' } }) };

    const wrapper = mountPage();

    expect(JSON.parse(wrapper.find('[data-testid="conversation"]').attributes('data-context')!)).toEqual({
      route: 'dashboard.account',
      entity: { kind: 'account', id: 'a1' },
    });
  });

  it('has no context without the route query', () => {
    expect(mountPage().find('[data-testid="conversation"]').attributes('data-context')).toBe('null');
  });

  it('shows the title and usage of the open thread, and when it expires', () => {
    route.name = ROUTES_NAMES.chatThread;
    route.params = { threadId: 'thread-1' };
    thread.value = {
      id: 'thread-1',
      title: 'Grocery spending',
      usage: { inputTokens: 5, outputTokens: 5, cachedInputTokens: 0 },
      expiresAt: '2026-04-05T10:00:00.000Z',
      pinned: false,
    };

    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="chat-title"]').text()).toBe('Grocery spending');
    expect(wrapper.find('[data-testid="usage"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chat-expiry"]').text()).toContain('Deleted automatically on');
  });

  it('says a pinned thread is kept', () => {
    route.name = ROUTES_NAMES.chatThread;
    route.params = { threadId: 'thread-1' };
    thread.value = {
      id: 'thread-1',
      title: 'Pinned one',
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      expiresAt: null,
      pinned: true,
    };

    expect(mountPage().find('[data-testid="chat-expiry"]').text()).toBe('Kept until you delete it');
  });

  it('toggles the history list in the narrow layout', async () => {
    const wrapper = mountPage();
    const list = wrapper.find('[data-testid="history-pane"]');
    expect(list.classes()).toContain('hidden');

    await wrapper.find('[data-testid="history-toggle"]').trigger('click');

    expect(wrapper.find('[data-testid="history-pane"]').classes()).not.toContain('hidden');
  });
});
