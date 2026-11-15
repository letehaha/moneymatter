import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatToolCallPart } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ToolCallsDetails from './tool-calls-details.vue';

const call = (overrides: Partial<ChatToolCallPart> & { id: string }): ChatToolCallPart => ({
  type: 'toolCall',
  callId: `call-${overrides.id}`,
  toolName: 'search_transactions',
  args: {},
  status: 'ok',
  ...overrides,
});

const mountDetails = ({ parts }: { parts: ChatToolCallPart[] }) =>
  mount(ToolCallsDetails, {
    props: { parts },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enChat }, missingWarn: false })] },
  });

describe('ToolCallsDetails', () => {
  it('counts the lookups in its title and stays closed', () => {
    const wrapper = mountDetails({ parts: [call({ id: '1' }), call({ id: '2' })] });

    expect(wrapper.find('[data-testid="tool-calls-toggle"]').text()).toBe('Details: 2 lookups');
    expect(wrapper.find('[data-testid="tool-call"]').exists()).toBe(false);
  });

  it('uses the singular for one lookup', () => {
    expect(mountDetails({ parts: [call({ id: '1' })] }).text()).toContain('Details: 1 lookup');
  });

  it('renders nothing without tool calls', () => {
    expect(mountDetails({ parts: [] }).text()).toBe('');
  });

  it('lists each call with its arguments, status and duration once opened', async () => {
    const wrapper = mountDetails({
      parts: [
        call({ id: '1', args: { text: 'bolt' }, durationMs: 120, resultSummary: '3 transactions' }),
        call({ id: '2', toolName: 'get_account', status: 'error', error: 'Not found' }),
        call({ id: '3', toolName: 'get_tracker', status: 'running' }),
      ],
    });

    await wrapper.find('[data-testid="tool-calls-toggle"]').trigger('click');
    const rows = wrapper.findAll('[data-testid="tool-call"]').map((row) => row.text());

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('search_transactions');
    expect(rows[0]).toContain('{"text":"bolt"}');
    expect(rows[0]).toContain('120 ms');
    expect(rows[0]).toContain('3 transactions');
    expect(rows[1]).toContain('Failed');
    expect(rows[1]).toContain('Not found');
    expect(rows[2]).toContain('Running');
  });

  it('shows markup in arguments and results as text', async () => {
    const wrapper = mountDetails({
      parts: [call({ id: '1', args: { q: '<script>alert(1)</script>' }, resultSummary: '<img src=x>' })],
    });

    await wrapper.find('[data-testid="tool-calls-toggle"]').trigger('click');

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });
});
