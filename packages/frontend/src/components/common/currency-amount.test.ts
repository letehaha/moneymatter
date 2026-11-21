import { registerCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers/currency-decimals';
import type { CurrencyMeta } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import CurrencyAmount from './currency-amount.vue';

const tooltipStub = (kind: string) => ({
  props: ['content'],
  template: `<div data-testid="tooltip" data-kind="${kind}" :data-content="content"><slot /></div>`,
});

const mountIt = (props: {
  amount: number;
  owner: { currencyCode: string; currencyMeta?: CurrencyMeta | null };
  bare?: boolean;
  responsive?: boolean;
}) =>
  mount(CurrencyAmount, {
    props,
    global: {
      stubs: { DesktopOnlyTooltip: tooltipStub('desktop'), ResponsiveTooltip: tooltipStub('responsive') },
    },
  });

const btc = { currencyCode: 'BTC' };

describe('CurrencyAmount', () => {
  afterEach(() => {
    resetCurrencyDecimals();
  });

  it('renders an ISO amount as before, without a tooltip', () => {
    const wrapper = mountIt({ amount: 1234.5, owner: { currencyCode: 'USD' } });

    expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('$1,234.50');
  });

  it('renders a custom amount that fits without a tooltip', () => {
    registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
    const wrapper = mountIt({ amount: 1, owner: btc });

    expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('1.00 BTC');
  });

  it('reveals the full amount of a shortened custom amount in a desktop tooltip', () => {
    registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
    const wrapper = mountIt({ amount: -1.23456789, owner: btc });

    const tooltip = wrapper.find('[data-testid="tooltip"]');
    expect(tooltip.attributes('data-kind')).toBe('desktop');
    expect(tooltip.text()).toBe('-1.235 BTC');
    expect(tooltip.attributes('data-content')).toBe('-1.23456789 BTC');
  });

  it('uses the tap-capable tooltip when responsive', () => {
    registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
    const wrapper = mountIt({ amount: 1.23456789, owner: btc, responsive: true });

    expect(wrapper.find('[data-testid="tooltip"]').attributes('data-kind')).toBe('responsive');
  });

  it('keeps the code in the tooltip of a bare amount', () => {
    registerCurrencyDecimals({ entries: [{ code: 'BTC', decimals: 8, isCustom: true }] });
    const wrapper = mountIt({ amount: 0.00012345, owner: btc, bare: true });

    const tooltip = wrapper.find('[data-testid="tooltip"]');
    expect(tooltip.text()).toBe('0.0001235');
    expect(tooltip.attributes('data-content')).toBe('0.00012345 BTC');
  });

  it("follows the owner's definition over the viewer's own", () => {
    registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });
    const wrapper = mountIt({
      amount: 0.12345678,
      owner: { currencyCode: 'SAT', currencyMeta: { decimals: 8, symbol: null, isCustom: true } },
    });

    const tooltip = wrapper.find('[data-testid="tooltip"]');
    expect(tooltip.text()).toBe('0.1235 SAT');
    expect(tooltip.attributes('data-content')).toBe('0.12345678 SAT');
  });
});
