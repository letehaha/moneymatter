import type { ChatSource } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CardSources from './card-sources.vue';
import { createChatI18n } from './card-test-fixtures';

const mountSources = ({ sources }: { sources: ChatSource[] }) =>
  mount(CardSources, { props: { sources }, global: { plugins: [createChatI18n()] } });

describe('CardSources', () => {
  it('lists a tool call with its compact arguments', () => {
    const wrapper = mountSources({
      sources: [{ type: 'toolCall', callId: 'c1', toolName: 'search_transactions', args: { text: 'bolt', limit: 5 } }],
    });

    expect(wrapper.text()).toContain('Looked up with search_transactions');
    expect(wrapper.text()).toContain('{"text":"bolt","limit":5}');
  });

  it('lists an attachment by file name', () => {
    const wrapper = mountSources({
      sources: [{ type: 'attachment', attachmentId: 'a1', fileName: 'statement.pdf' }],
    });

    expect(wrapper.text()).toContain('Attachment statement.pdf');
  });

  it('lists the page context and an analysis', () => {
    const wrapper = mountSources({
      sources: [
        { type: 'pageContext', context: { route: 'account' } },
        { type: 'analysis', partId: 'p1' },
      ],
    });

    expect(wrapper.text()).toContain('The page you had open');
    expect(wrapper.text()).toContain('An analysis in this answer');
  });

  it('renders markup in an argument as text', () => {
    const wrapper = mountSources({
      sources: [{ type: 'toolCall', callId: 'c1', toolName: 'x', args: { q: '<img src=x onerror=alert(1)>' } }],
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x');
  });

  it('says so when there are no sources', () => {
    expect(mountSources({ sources: [] }).text()).toContain('No sources were recorded.');
  });
});
