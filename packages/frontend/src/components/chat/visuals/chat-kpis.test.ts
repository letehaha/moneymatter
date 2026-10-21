import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatKpisSpec } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ChatKpis from './chat-kpis.vue';

const mountKpis = ({ spec }: { spec: ChatKpisSpec }) =>
  mount(ChatKpis, {
    props: { spec },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enChat } })] },
  });

const kpis = (items: ChatKpisSpec['items']): ChatKpisSpec => ({ type: 'kpis', items });

describe('ChatKpis', () => {
  it('shows each tile with its label and a formatted value', () => {
    const wrapper = mountKpis({
      spec: kpis([
        { label: 'Spent', value: 1234.5, kind: 'money', currencyCode: 'EUR' },
        { label: 'Savings rate', value: 18.25, kind: 'percent' },
        { label: 'Transactions', value: 42, kind: 'number' },
      ]),
    });
    const tiles = wrapper.findAll('[data-testid="kpi"]');

    expect(tiles).toHaveLength(3);
    expect(tiles[0]!.text()).toContain('Spent');
    expect(tiles[0]!.text()).toContain('€1,234.50');
    expect(tiles[1]!.text()).toContain('18.25%');
    expect(tiles[2]!.text()).toContain('42');
  });

  it('colors an upward delta as income and a downward one as expense', () => {
    const wrapper = mountKpis({
      spec: kpis([
        { label: 'A', value: 1, kind: 'number', delta: { value: 12.5, kind: 'percent', direction: 'up' } },
        { label: 'B', value: 1, kind: 'number', delta: { value: 3, kind: 'percent', direction: 'down' } },
      ]),
    });
    const [up, down] = wrapper.findAll('[data-testid="kpi-delta"]');

    expect(up!.attributes('data-direction')).toBe('up');
    expect(up!.classes()).toContain('text-app-income-color');
    expect(up!.text()).toContain('12.5%');
    expect(down!.attributes('data-direction')).toBe('down');
    expect(down!.classes()).toContain('text-app-expense-color');
  });

  it('shows a flat delta muted', () => {
    const wrapper = mountKpis({
      spec: kpis([{ label: 'A', value: 1, kind: 'number', delta: { value: 0, kind: 'percent', direction: 'flat' } }]),
    });
    const delta = wrapper.find('[data-testid="kpi-delta"]');

    expect(delta.attributes('data-direction')).toBe('flat');
    expect(delta.classes()).toContain('text-muted-foreground');
    expect(delta.classes()).not.toContain('text-app-income-color');
  });

  it('formats a money delta in the tile currency and shows its magnitude', () => {
    const wrapper = mountKpis({
      spec: kpis([
        {
          label: 'Spent',
          value: 500,
          kind: 'money',
          currencyCode: 'USD',
          delta: { value: -80, kind: 'money', direction: 'down' },
        },
      ]),
    });

    expect(wrapper.find('[data-testid="kpi-delta"]').text()).toContain('$80.00');
    expect(wrapper.find('[data-testid="kpi-delta"]').text()).not.toContain('-');
  });

  it('says the direction to assistive technology', () => {
    const wrapper = mountKpis({
      spec: kpis([{ label: 'A', value: 1, kind: 'number', delta: { value: 2, kind: 'percent', direction: 'up' } }]),
    });

    expect(wrapper.find('[data-testid="kpi-delta"] .sr-only').text()).toBe('Up');
  });

  it('shows no delta when there is none', () => {
    const wrapper = mountKpis({ spec: kpis([{ label: 'A', value: 1, kind: 'number' }]) });

    expect(wrapper.find('[data-testid="kpi-delta"]').exists()).toBe(false);
  });
});
