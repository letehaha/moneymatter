import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatNoticePart } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import NoticePart from './notice-part.vue';

const mountNotice = ({ key, params = {} }: { key: string; params?: ChatNoticePart['params'] }) =>
  mount(NoticePart, {
    props: { part: { type: 'notice', id: 'n1', key, params } },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enChat }, missingWarn: false })],
    },
  });

describe('NoticePart', () => {
  it('fills the parameters of the step limit notice', () => {
    expect(mountNotice({ key: 'chat.notices.stepLimit', params: { limit: 25 } }).text()).toBe(
      'Stopped after 25 steps. Ask again to continue.',
    );
  });

  it.each([
    ['chat.notices.cancelled', {}, 'Stopped at your request.'],
    ['chat.notices.interrupted', {}, 'The server restarted, so this answer was cut short.'],
    ['chat.notices.toolCallLimit', { limit: 60 }, 'This message reached its limit of 60 tool calls.'],
    ['chat.notices.proposalLimit', { limit: 100 }, 'This message reached its limit of 100 proposed changes.'],
    [
      'chat.notices.thirdPartyReadLimit',
      { limit: 10 },
      'This message reached its limit of 10 lookups in outside services.',
    ],
    ['chat.notices.analysisLimit', { limit: 5 }, 'This message reached its limit of 5 analyses.'],
    ['chat.notices.visualLimit', { limit: 8 }, 'This message reached its limit of 8 charts and tables.'],
  ])('shows %s', (key, params, text) => {
    expect(mountNotice({ key, params }).text()).toBe(text);
  });

  it('falls back to a generic line for a key it does not know', () => {
    const wrapper = mountNotice({ key: 'chat.notices.somethingNew' });

    expect(wrapper.text()).toBe('Notice from the assistant.');
    expect(wrapper.text()).not.toContain('somethingNew');
  });

  it('is announced politely to assistive technology', () => {
    expect(mountNotice({ key: 'chat.notices.cancelled' }).attributes('role')).toBe('status');
  });
});
