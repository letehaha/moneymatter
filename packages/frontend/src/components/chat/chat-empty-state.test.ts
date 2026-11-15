import { ROUTES_NAMES } from '@/routes/constants';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { createChatI18n } from './cards/card-test-fixtures';
import ChatEmptyState from './chat-empty-state.vue';

const mountEmpty = ({ isConfigured = true }: { isConfigured?: boolean } = {}) =>
  mount(ChatEmptyState, {
    props: { isConfigured },
    global: { plugins: [createChatI18n()], stubs: { RouterLink: RouterLinkStub } },
  });

describe('ChatEmptyState', () => {
  it('explains what chat does and offers example prompts', () => {
    const wrapper = mountEmpty();

    expect(wrapper.text()).toContain('Ask anything about your money');
    expect(wrapper.findAll('[data-testid="example-prompt"]')).toHaveLength(4);
  });

  it('hands the text of a prompt up when it is chosen', async () => {
    const wrapper = mountEmpty();

    await wrapper.findAll('[data-testid="example-prompt"]')[0]!.trigger('click');

    expect(wrapper.emitted('prompt')).toEqual([['Where did my money go last month?']]);
  });

  it('sends a user without a model to the AI settings instead of offering prompts', () => {
    const wrapper = mountEmpty({ isConfigured: false });

    expect(wrapper.text()).toContain('Connect a model to start');
    expect(wrapper.findAll('[data-testid="example-prompt"]')).toHaveLength(0);
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ name: ROUTES_NAMES.settingsAiModels });
  });
});
