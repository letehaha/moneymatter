import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatAnalysisPart } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import AnalysisPart from './analysis-part.vue';

const analysis = (overrides: Partial<ChatAnalysisPart> = {}): ChatAnalysisPart => ({
  type: 'analysis',
  id: 'an1',
  code: 'return inputs.rows.length;',
  inputs: [],
  status: 'ok',
  ...overrides,
});

const mountAnalysis = ({ part }: { part: ChatAnalysisPart }) =>
  mount(AnalysisPart, {
    props: { part },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enChat }, missingWarn: false })] },
  });

const open = async ({ wrapper }: { wrapper: ReturnType<typeof mountAnalysis> }) => {
  await wrapper.find('[data-testid="analysis-toggle"]').trigger('click');
  return wrapper;
};

describe('AnalysisPart', () => {
  it('shows its title, status and duration closed', () => {
    const wrapper = mountAnalysis({ part: analysis({ durationMs: 340 }) });

    expect(wrapper.find('[data-testid="analysis-toggle"]').text()).toContain('Analysis');
    expect(wrapper.text()).toContain('Done');
    expect(wrapper.text()).toContain('340 ms');
    expect(wrapper.find('pre').exists()).toBe(false);
  });

  it('shows the code, the data it used and the result once opened', async () => {
    const wrapper = await open({
      wrapper: mountAnalysis({
        part: analysis({
          inputs: [
            { name: 'rows', source: { tool: 'search_transactions', args: { text: 'bolt' } } },
            { name: 'accounts', source: { fromCall: 'call-1' } },
          ],
          output: { total: 42 },
        }),
      }),
    });

    expect(wrapper.find('[data-testid="analysis-code"]').text()).toBe('return inputs.rows.length;');
    expect(wrapper.text()).toContain('rows');
    expect(wrapper.text()).toContain('Read with search_transactions');
    expect(wrapper.text()).toContain('Result of an earlier lookup');
    expect(wrapper.find('[data-testid="analysis-output"]').text()).toContain('"total": 42');
  });

  it('shows the error of a failed analysis', async () => {
    const wrapper = await open({
      wrapper: mountAnalysis({ part: analysis({ status: 'error', error: 'Out of memory' }) }),
    });

    expect(wrapper.text()).toContain('Failed');
    expect(wrapper.find('[data-testid="analysis-error"]').text()).toBe('Out of memory');
  });

  it('shows a running analysis without a result', async () => {
    const wrapper = await open({ wrapper: mountAnalysis({ part: analysis({ status: 'running' }) }) });

    expect(wrapper.text()).toContain('Running');
    expect(wrapper.find('[data-testid="analysis-output"]').exists()).toBe(false);
  });

  it('shows code and results as text, never as markup', async () => {
    const wrapper = await open({
      wrapper: mountAnalysis({ part: analysis({ code: '<img src=x onerror=alert(1)>', output: '<b>bold</b>' }) }),
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.find('[data-testid="analysis-code"]').text()).toBe('<img src=x onerror=alert(1)>');
  });
});
