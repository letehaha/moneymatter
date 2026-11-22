import { mount } from '@vue/test-utils';
import { enUS } from 'date-fns/locale';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import RateSummary from './rate-summary.vue';

vi.mock('@/composable/use-date-locale', () => ({ getDateFnsLocale: () => enUS }));

const { history } = vi.hoisted(() => ({
  history: { rates: [] as { effectiveDate: string; isInForce: boolean }[] },
}));

vi.mock('../rate-source/use-rate-history', async () => {
  const { ref } = await import('vue');
  return { useRateHistory: () => ({ rates: ref(history.rates) }) };
});

const inForceOn = ({ day }: { day: string }) => {
  history.rates = [
    { effectiveDate: '2026-11-25', isInForce: false },
    { effectiveDate: day, isInForce: true },
  ];
};

vi.mock('./rate-form-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean, rate: { type: Object, default: undefined } },
      setup: (props) => () =>
        props.open ? h('div', { 'data-testid': 'rate-form-dialog', 'data-mode': props.rate ? 'edit' : 'add' }) : null,
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      settings: {
        currencies: {
          dialog: {
            row: { rate: '1 {code} = {rate} {quote}' },
            summary: {
              since: 'Since {date}',
              follows: 'Follows {code}',
              updated: 'Updated {date}',
              live: 'Live',
              yourRate: 'Your rate',
            },
          },
        },
      },
    },
  },
});

const TETHER = {
  currencyCode: 'USDT',
  quoteCode: 'USD',
  rate: 0.9998,
  quoteRate: 1.0002,
  isCustomCurrency: true,
  custom: false,
  rateSource: 'manual',
  rateSourceConfig: null,
};

const HRYVNIA = {
  currencyCode: 'UAH',
  quoteCode: 'USD',
  rate: 0.0222,
  quoteRate: 45.0532,
  isCustomCurrency: false,
  custom: false,
  rateSource: 'manual',
  rateSourceConfig: null,
};

const mountSummary = ({ currency }: { currency: object }) =>
  mount(RateSummary, {
    props: { currency: currency as CurrencyWithExchangeRate },
    global: { plugins: [i18n] },
  });

const text = (wrapper: ReturnType<typeof mountSummary>, testId: string) =>
  wrapper.find(`[data-testid="${testId}"]`).text().replace(/\s+/g, ' ');

describe('RateSummary', () => {
  beforeEach(() => {
    inForceOn({ day: '2026-11-14' });
  });

  it('leads a custom currency with its own unit and dates the rate in force from the history', () => {
    const wrapper = mountSummary({ currency: TETHER });

    expect(text(wrapper, 'rate-summary-main')).toBe('1 USDT = 0.9998 USD');
    expect(text(wrapper, 'rate-summary-inverse')).toBe('1 USD = 1.0002 USDT');
    expect(text(wrapper, 'rate-summary-chip')).toBe('Since Nov 14, 2026');
  });

  it('hides the date chip while the history holds no rate in force', () => {
    history.rates = [];
    const wrapper = mountSummary({ currency: TETHER });

    expect(wrapper.find('[data-testid="rate-summary-chip"]').exists()).toBe(false);
  });

  it('opens the rate form in add mode for a rate the user enters', async () => {
    const wrapper = mountSummary({ currency: TETHER });

    await wrapper.get('[data-testid="rate-summary-update"]').trigger('click');

    expect(wrapper.get('[data-testid="rate-form-dialog"]').attributes('data-mode')).toBe('add');
  });

  it('names the followed currency and offers no rate update', () => {
    const wrapper = mountSummary({
      currency: { ...TETHER, rateSource: 'peg', rateSourceConfig: { pegCurrency: 'EUR', factor: 1 } },
    });

    expect(text(wrapper, 'rate-summary-chip')).toBe('Follows EUR');
    expect(wrapper.find('[data-testid="rate-summary-update"]').exists()).toBe(false);
  });

  it('says when a synced rate was last updated', () => {
    inForceOn({ day: '2026-11-21' });
    const wrapper = mountSummary({
      currency: { ...TETHER, rateSource: 'coingecko', rateSourceConfig: { coinId: 'tether', quoteCurrency: 'USD' } },
    });

    expect(text(wrapper, 'rate-summary-chip')).toBe('Updated Nov 21, 2026');
    expect(wrapper.find('[data-testid="rate-summary-update"]').exists()).toBe(false);
  });

  it('leads an ISO currency with the base currency, live or the user’s own', () => {
    const live = mountSummary({ currency: HRYVNIA });

    expect(text(live, 'rate-summary-main')).toBe('1 USD = 45.0532 UAH');
    expect(text(live, 'rate-summary-inverse')).toBe('1 UAH = 0.0222 USD');
    expect(text(live, 'rate-summary-chip')).toBe('Live');
    expect(live.find('[data-testid="rate-summary-update"]').exists()).toBe(false);

    expect(text(mountSummary({ currency: { ...HRYVNIA, custom: true } }), 'rate-summary-chip')).toBe('Your rate');
  });
});
