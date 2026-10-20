import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHAT_PANEL_DEFAULT_WIDTH,
  CHAT_PANEL_MAX_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  CHAT_PANEL_STORAGE_KEY,
  useChatPanelStore,
} from './chat-panel';

describe('chat panel store', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts closed at the default width', () => {
    const store = useChatPanelStore();

    expect(store.isOpen).toBe(false);
    expect(store.width).toBe(CHAT_PANEL_DEFAULT_WIDTH);
  });

  it('opens, closes and toggles', () => {
    const store = useChatPanelStore();

    store.open();
    expect(store.isOpen).toBe(true);
    store.toggle();
    expect(store.isOpen).toBe(false);
    store.toggle();
    store.close();
    expect(store.isOpen).toBe(false);
  });

  it('keeps the width inside its bounds', () => {
    const store = useChatPanelStore();

    store.setWidth(100);
    expect(store.width).toBe(CHAT_PANEL_MIN_WIDTH);
    store.setWidth(2000);
    expect(store.width).toBe(CHAT_PANEL_MAX_WIDTH);
    store.setWidth(480.4);
    expect(store.width).toBe(480);
  });

  it('remembers its state for the next load', () => {
    const first = useChatPanelStore();
    first.open();
    first.setWidth(500);

    setActivePinia(createPinia());
    const second = useChatPanelStore();

    expect(second.isOpen).toBe(true);
    expect(second.width).toBe(500);
  });

  it('falls back to the defaults for a stored value that is not usable', () => {
    localStorage.setItem(CHAT_PANEL_STORAGE_KEY, '{"isOpen":"yes","width":9999}');

    const store = useChatPanelStore();

    expect(store.isOpen).toBe(false);
    expect(store.width).toBe(CHAT_PANEL_DEFAULT_WIDTH);
  });

  it('works when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const store = useChatPanelStore();
    store.open();
    store.setWidth(400);

    expect(store.isOpen).toBe(true);
    expect(store.width).toBe(400);
  });

  it('remembers the conversation it shows for the session, without storing it', () => {
    const store = useChatPanelStore();
    expect(store.threadId).toBeNull();

    store.setThread({ threadId: 'thread-1' });

    expect(store.threadId).toBe('thread-1');
    expect(localStorage.getItem(CHAT_PANEL_STORAGE_KEY) ?? '').not.toContain('thread-1');

    store.setThread({ threadId: null });
    expect(store.threadId).toBeNull();
  });
});
