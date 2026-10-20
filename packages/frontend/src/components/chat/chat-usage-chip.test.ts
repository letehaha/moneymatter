import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { createChatI18n } from './cards/card-test-fixtures';
import ChatUsageChip from './chat-usage-chip.vue';

const mountChip = ({ inputTokens, outputTokens, cachedInputTokens = 0 }: Record<string, number>) =>
  mount(ChatUsageChip, {
    props: { usage: { inputTokens: inputTokens!, outputTokens: outputTokens!, cachedInputTokens } },
    global: { plugins: [createChatI18n()] },
  });

describe('ChatUsageChip', () => {
  it('shows the tokens of the thread, input and output together', () => {
    const wrapper = mountChip({ inputTokens: 9_000, outputTokens: 3_400 });

    expect(wrapper.text()).toBe('12.4K tokens');
  });

  it('shows small totals as they are', () => {
    expect(mountChip({ inputTokens: 600, outputTokens: 250 }).text()).toBe('850 tokens');
  });

  it('explains the split in its tooltip text', () => {
    const wrapper = mountChip({ inputTokens: 9_000, outputTokens: 3_400, cachedInputTokens: 5_000 });

    expect(wrapper.attributes('title')).toBe('In: 9,000 · Out: 3,400 · Cached: 5,000');
  });

  it('renders nothing before the thread has used any tokens', () => {
    expect(mountChip({ inputTokens: 0, outputTokens: 0 }).text()).toBe('');
  });
});
