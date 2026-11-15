import { createChatI18n } from '@/components/chat/cards/card-test-fixtures';
import type { ChatPageContext, ChatThreadSearchHit } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/chat/chat-context-label', () => ({
  useChatContextLabel: () => ({
    label: ({ context, names = {} }: { context: ChatPageContext; names?: Record<string, string> }) =>
      context.entity
        ? `Subscription: ${names[`${context.entity.kind}:${context.entity.id}`] ?? 'unnamed'}`
        : context.filters
          ? 'Transactions · filtered'
          : null,
  }),
}));

import ThreadListItem from './thread-list-item.vue';

const hit = (overrides: Partial<ChatThreadSearchHit> = {}): ChatThreadSearchHit => ({
  id: 't1',
  title: 'Grocery spending',
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

const mountItem = ({ thread = hit(), active = false }: { thread?: ChatThreadSearchHit; active?: boolean } = {}) =>
  mount(ThreadListItem, {
    props: { thread, active },
    global: { plugins: [createChatI18n()], stubs: { DesktopOnlyTooltip: { template: '<div><slot /></div>' } } },
  });

describe('ThreadListItem', () => {
  it('shows where the conversation started, with the name of the entity', () => {
    const wrapper = mountItem({
      thread: hit({
        pageContext: { route: 'dashboard.planned.subscription-details', entity: { kind: 'subscription', id: 's1' } },
        pageContextNames: { 'subscription:s1': 'Spotify' },
      }),
    });

    expect(wrapper.find('[data-testid="thread-context"]').text()).toBe('Subscription: Spotify');
  });

  it('shows a filtered list as such, and a neutral name for an entity that is gone', () => {
    const filtered = mountItem({
      thread: hit({ pageContext: { route: 'dashboard.transactions', filters: { tagIds: ['t'] } } }),
    });
    const gone = mountItem({
      thread: hit({ pageContext: { entity: { kind: 'subscription', id: 's9' } }, pageContextNames: {} }),
    });

    expect(filtered.find('[data-testid="thread-context"]').text()).toBe('Transactions · filtered');
    expect(gone.find('[data-testid="thread-context"]').text()).toBe('Subscription: unnamed');
  });

  it('shows no label for a conversation that started without a page', () => {
    expect(mountItem().find('[data-testid="thread-context"]').exists()).toBe(false);
  });

  it('shows the title and marks the open thread', () => {
    const wrapper = mountItem({ active: true });

    expect(wrapper.find('[data-testid="thread-select"]').text()).toContain('Grocery spending');
    expect(wrapper.find('[data-testid="thread-select"]').attributes('aria-current')).toBe('true');
  });

  it('falls back to a generic name for a thread without a title', () => {
    expect(mountItem({ thread: hit({ title: '' }) }).text()).toContain('New conversation');
  });

  it('shows the search snippet as plain text', () => {
    const wrapper = mountItem({ thread: hit({ snippet: 'spent <b>40</b> at the market' }) });

    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.text()).toContain('spent <b>40</b> at the market');
  });

  it('selects the thread', async () => {
    const wrapper = mountItem();

    await wrapper.find('[data-testid="thread-select"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([[]]);
  });

  it('asks to pin and to unpin', async () => {
    const pinned = mountItem({ thread: hit({ pinned: true }) });

    await pinned.find('[data-testid="thread-pin"]').trigger('click');

    expect(pinned.emitted('toggle-pin')).toHaveLength(1);
    expect(pinned.find('[data-testid="thread-pin"]').attributes('aria-label')).toBe('Unpin');
    expect(mountItem().find('[data-testid="thread-pin"]').attributes('aria-label')).toBe('Pin');
  });

  it('asks to delete', async () => {
    const wrapper = mountItem();

    await wrapper.find('[data-testid="thread-delete"]').trigger('click');

    expect(wrapper.emitted('delete')).toHaveLength(1);
  });

  describe('renaming', () => {
    const startRename = async ({ wrapper }: { wrapper: ReturnType<typeof mountItem> }) => {
      await wrapper.find('[data-testid="thread-rename"]').trigger('click');
      return wrapper.find('input');
    };

    it('turns the title into a field holding it', async () => {
      const input = await startRename({ wrapper: mountItem() });

      expect((input.element as HTMLInputElement).value).toBe('Grocery spending');
    });

    it('saves the trimmed name on Enter', async () => {
      const wrapper = mountItem();
      const input = await startRename({ wrapper });

      await input.setValue('  Food and drink  ');
      await input.trigger('keydown', { key: 'Enter' });

      expect(wrapper.emitted('rename')).toEqual([['Food and drink']]);
      expect(wrapper.find('input').exists()).toBe(false);
    });

    it('drops the edit on Escape', async () => {
      const wrapper = mountItem();
      const input = await startRename({ wrapper });

      await input.setValue('Something else');
      await input.trigger('keydown', { key: 'Escape' });

      expect(wrapper.emitted('rename')).toBeUndefined();
      expect(wrapper.find('input').exists()).toBe(false);
    });

    it('does not save a blank or unchanged name', async () => {
      const wrapper = mountItem();
      const input = await startRename({ wrapper });

      await input.setValue('   ');
      await input.trigger('keydown', { key: 'Enter' });
      const again = await startRename({ wrapper });
      await again.trigger('keydown', { key: 'Enter' });

      expect(wrapper.emitted('rename')).toBeUndefined();
    });
  });
});
