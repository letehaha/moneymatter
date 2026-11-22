import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import SourceSummaryRow from './source-summary-row.vue';

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
            source: {
              manual: 'You enter it yourself',
              peg: 'Follows {code}',
              pegDetail: 'Always 1 {code} = {factor} {target}',
              http: 'Custom URL · {host}',
              syncedDetail: 'Updated every night',
            },
          },
        },
      },
    },
  },
});

const mountRow = ({ currency }: { currency: object }) =>
  mount(SourceSummaryRow, {
    props: { currency: { currencyCode: 'USDT', ...currency } as CurrencyWithExchangeRate },
    global: { plugins: [i18n] },
  });

describe('SourceSummaryRow', () => {
  it('shows a rate the user enters with no detail line, and asks to change it', async () => {
    const wrapper = mountRow({ currency: { rateSource: 'manual', rateSourceConfig: null } });

    expect(wrapper.get('[data-testid="source-summary-value"]').text()).toBe('You enter it yourself');
    expect(wrapper.find('[data-testid="source-summary-detail"]').exists()).toBe(false);

    await wrapper.get('[data-testid="source-summary-change"]').trigger('click');
    expect(wrapper.emitted('change')).toHaveLength(1);
  });

  it('shows the followed currency and the fixed amount', () => {
    const wrapper = mountRow({ currency: { rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1 } } });

    expect(wrapper.get('[data-testid="source-summary-value"]').text()).toBe('Follows USD');
    expect(wrapper.get('[data-testid="source-summary-detail"]').text()).toBe('Always 1 USDT = 1 USD');
  });

  it('shows the host of a custom URL and that it updates nightly', () => {
    const wrapper = mountRow({
      currency: {
        rateSource: 'http',
        rateSourceConfig: {
          urlTemplate: 'https://rates.example.org/{date}',
          jsonPath: '$.r',
          quoteCurrency: 'USD',
          headerNames: [],
        },
      },
    });

    expect(wrapper.get('[data-testid="source-summary-value"]').text()).toBe('Custom URL · rates.example.org');
    expect(wrapper.get('[data-testid="source-summary-detail"]').text()).toBe('Updated every night');
  });
});
