import { useChatThread } from '@/composable/data-queries/chat';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  CHAT_PANEL_DEFAULT_WIDTH,
  CHAT_PANEL_MAX_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  useChatPanelStore,
} from '@/stores/chat-panel';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import { createChatI18n } from './cards/card-test-fixtures';
import ChatPanel from './chat-panel.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ name: 'dashboard.account', params: {} }),
}));
vi.mock('@/i18n', () => ({ ensureChunkLoaded: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/composable/chat/use-chat-page-context', () => ({
  useChatPageContext: () => ({
    context: computed(() => ({ route: 'dashboard.account', entity: { kind: 'account', id: 'a1' } })),
  }),
  chatPageContextToQuery: ({ context }: { context: object }) => ({ context: JSON.stringify(context) }),
}));
vi.mock('@/composable/data-queries/chat', () => ({ useChatThread: vi.fn() }));

// The conversation reaches into the API layer; its own suite covers it.
vi.mock('./chat-conversation.vue', async () => {
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
            onClick: () => emit('thread-created', 'created-1'),
          }),
    }),
  };
});

const thread = ref<{ id: string; title: string; usage: object } | null>(null);

const mountPanel = () =>
  mount(ChatPanel, {
    global: {
      plugins: [createChatI18n()],
      stubs: {
        ChatUsageChip: { template: '<span data-testid="usage" />' },
        DesktopOnlyTooltip: { template: '<div><slot /></div>' },
      },
    },
  });

describe('ChatPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    push.mockReset();
    thread.value = null;
    vi.mocked(useChatThread).mockReturnValue({ thread: computed(() => thread.value) } as unknown as ReturnType<
      typeof useChatThread
    >);
  });

  it('takes the width the store keeps', async () => {
    const store = useChatPanelStore();
    store.setWidth(480);

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-panel"]').attributes('style')).toContain('width: 480px');
  });

  it('shows the conversation the store remembers', async () => {
    useChatPanelStore().setThread({ threadId: 'thread-1' });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation"]').attributes('data-thread')).toBe('thread-1');
  });

  it('remembers the thread a first message created', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="conversation"]').trigger('click');

    expect(useChatPanelStore().threadId).toBe('created-1');
  });

  it('closes itself', async () => {
    const store = useChatPanelStore();
    store.open();
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="panel-close"]').trigger('click');

    expect(store.isOpen).toBe(false);
  });

  it('starts a new conversation', async () => {
    useChatPanelStore().setThread({ threadId: 'thread-1' });
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="panel-new-chat"]').trigger('click');

    expect(useChatPanelStore().threadId).toBeNull();
  });

  it('shows the title and the usage of the conversation', async () => {
    useChatPanelStore().setThread({ threadId: 'thread-1' });
    thread.value = {
      id: 'thread-1',
      title: 'Grocery spending',
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    };

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="panel-title"]').text()).toBe('Grocery spending');
    expect(wrapper.find('[data-testid="usage"]').exists()).toBe(true);
  });

  it('opens the conversation in the Chat page, with the page it was opened on', async () => {
    useChatPanelStore().setThread({ threadId: 'thread-1' });
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="panel-open-page"]').trigger('click');

    expect(push).toHaveBeenCalledWith({ name: ROUTES_NAMES.chatThread, params: { threadId: 'thread-1' } });
  });

  it('opens the Chat page with the page context when there is no conversation yet', async () => {
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="panel-open-page"]').trigger('click');

    expect(push).toHaveBeenCalledWith({
      name: ROUTES_NAMES.chat,
      query: { context: JSON.stringify({ route: 'dashboard.account', entity: { kind: 'account', id: 'a1' } }) },
    });
  });

  it('closes the panel when it hands over to the page, which shows the conversation itself', async () => {
    const store = useChatPanelStore();
    store.open();
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="panel-open-page"]').trigger('click');

    expect(store.isOpen).toBe(false);
  });

  describe('resizing', () => {
    const handle = ({ wrapper }: { wrapper: ReturnType<typeof mountPanel> }) =>
      wrapper.find('[data-testid="panel-resize"]');

    it('grows to the left with the arrow keys, which is where the handle sits', async () => {
      const wrapper = mountPanel();
      await flushPromises();

      await handle({ wrapper }).trigger('keydown', { key: 'ArrowLeft' });

      expect(useChatPanelStore().width).toBe(CHAT_PANEL_DEFAULT_WIDTH + 16);
      expect(handle({ wrapper }).attributes('aria-valuenow')).toBe(String(CHAT_PANEL_DEFAULT_WIDTH + 16));
    });

    it('shrinks with the right arrow and stops at the minimum', async () => {
      useChatPanelStore().setWidth(CHAT_PANEL_MIN_WIDTH + 8);
      const wrapper = mountPanel();
      await flushPromises();

      await handle({ wrapper }).trigger('keydown', { key: 'ArrowRight' });
      await handle({ wrapper }).trigger('keydown', { key: 'ArrowRight' });

      expect(useChatPanelStore().width).toBe(CHAT_PANEL_MIN_WIDTH);
    });

    it('stops at the maximum', async () => {
      useChatPanelStore().setWidth(CHAT_PANEL_MAX_WIDTH);
      const wrapper = mountPanel();
      await flushPromises();

      await handle({ wrapper }).trigger('keydown', { key: 'ArrowLeft' });

      expect(useChatPanelStore().width).toBe(CHAT_PANEL_MAX_WIDTH);
    });

    it('reports its bounds to assistive technology', async () => {
      const wrapper = mountPanel();
      await flushPromises();

      expect(handle({ wrapper }).attributes()).toMatchObject({
        role: 'separator',
        'aria-valuemin': String(CHAT_PANEL_MIN_WIDTH),
        'aria-valuemax': String(CHAT_PANEL_MAX_WIDTH),
      });
    });
  });
});
