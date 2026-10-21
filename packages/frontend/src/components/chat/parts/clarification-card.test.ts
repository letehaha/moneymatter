import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatClarificationPart } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ClarificationCard from './clarification-card.vue';

const clarification = (overrides: Partial<ChatClarificationPart> = {}): ChatClarificationPart => ({
  type: 'clarification',
  id: 'cl1',
  question: 'Which account did you pay from?',
  options: [
    { id: 'o1', label: 'Main card' },
    { id: 'o2', label: 'Cash' },
  ],
  allowFreeText: false,
  multiSelect: false,
  ...overrides,
});

const mountCard = ({ part, disabled = false }: { part: ChatClarificationPart; disabled?: boolean }) =>
  mount(ClarificationCard, {
    props: { part, disabled },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enChat }, missingWarn: false })] },
  });

const option = ({ wrapper, id }: { wrapper: ReturnType<typeof mountCard>; id: string }) =>
  wrapper.find(`[data-testid="option-${id}"]`);

describe('ClarificationCard', () => {
  it('shows the question and the options', () => {
    const wrapper = mountCard({ part: clarification() });

    expect(wrapper.text()).toContain('Which account did you pay from?');
    expect(option({ wrapper, id: 'o1' }).text()).toBe('Main card');
    expect(option({ wrapper, id: 'o2' }).text()).toBe('Cash');
  });

  it('shows the question and labels as text, never as markup', () => {
    const wrapper = mountCard({
      part: clarification({
        question: '<img src=x onerror=alert(1)> Which one?',
        options: [{ id: 'o1', label: '<b>Card</b>' }],
      }),
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.text()).toContain('<b>Card</b>');
  });

  it('keeps send disabled until something is chosen', () => {
    expect(
      mountCard({ part: clarification() }).find('[data-testid="send-answer"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('selects one option at a time and sends it', async () => {
    const wrapper = mountCard({ part: clarification() });

    await option({ wrapper, id: 'o1' }).trigger('click');
    await option({ wrapper, id: 'o2' }).trigger('click');

    expect(option({ wrapper, id: 'o1' }).attributes('aria-pressed')).toBe('false');
    expect(option({ wrapper, id: 'o2' }).attributes('aria-pressed')).toBe('true');

    await wrapper.find('[data-testid="send-answer"]').trigger('click');

    expect(wrapper.emitted('answer')).toEqual([[{ clarificationId: 'cl1', optionIds: ['o2'] }]]);
  });

  it('selects several options when multi-select is on', async () => {
    const wrapper = mountCard({ part: clarification({ multiSelect: true }) });

    await option({ wrapper, id: 'o1' }).trigger('click');
    await option({ wrapper, id: 'o2' }).trigger('click');
    await wrapper.find('[data-testid="send-answer"]').trigger('click');

    expect(wrapper.emitted('answer')).toEqual([[{ clarificationId: 'cl1', optionIds: ['o1', 'o2'] }]]);
  });

  it('toggles a multi-select option off again', async () => {
    const wrapper = mountCard({ part: clarification({ multiSelect: true }) });

    await option({ wrapper, id: 'o1' }).trigger('click');
    await option({ wrapper, id: 'o1' }).trigger('click');

    expect(wrapper.find('[data-testid="send-answer"]').attributes('disabled')).toBeDefined();
  });

  it('takes free text only when it is allowed, and sends it alone', async () => {
    expect(mountCard({ part: clarification() }).find('[data-testid="free-text"]').exists()).toBe(false);

    const wrapper = mountCard({ part: clarification({ allowFreeText: true }) });
    await wrapper.find('[data-testid="free-text"] textarea').setValue('  The joint account ');
    await wrapper.find('[data-testid="send-answer"]').trigger('click');

    expect(wrapper.emitted('answer')).toEqual([
      [{ clarificationId: 'cl1', optionIds: [], freeText: 'The joint account' }],
    ]);
  });

  it('sends an option together with free text', async () => {
    const wrapper = mountCard({ part: clarification({ allowFreeText: true }) });

    await option({ wrapper, id: 'o1' }).trigger('click');
    await wrapper.find('[data-testid="free-text"] textarea').setValue('only the part after tax');
    await wrapper.find('[data-testid="send-answer"]').trigger('click');

    expect(wrapper.emitted('answer')).toEqual([
      [{ clarificationId: 'cl1', optionIds: ['o1'], freeText: 'only the part after tax' }],
    ]);
  });

  it('locks after it was answered and shows the answer', () => {
    const wrapper = mountCard({
      part: clarification({ allowFreeText: true, answer: { optionIds: ['o2'], freeText: 'Joint account' } }),
    });

    expect(option({ wrapper, id: 'o1' }).attributes('disabled')).toBeDefined();
    expect(option({ wrapper, id: 'o2' }).attributes('disabled')).toBeDefined();
    expect(option({ wrapper, id: 'o2' }).attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[data-testid="send-answer"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Answered');
    expect(wrapper.text()).toContain('Joint account');
  });

  it('locks while the parent is sending the answer', () => {
    const wrapper = mountCard({ part: clarification(), disabled: true });

    expect(option({ wrapper, id: 'o1' }).attributes('disabled')).toBeDefined();
  });
});
