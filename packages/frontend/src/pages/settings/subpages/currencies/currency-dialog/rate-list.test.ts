import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import type { CurrencyRateHistoryItem, CurrencyRateSource } from '@bt/shared/types';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import RateList from './rate-list.vue';

vi.mock('@/components/lib/ui/tooltip', async () => {
  const { defineComponent } = await import('vue');
  return {
    DesktopOnlyTooltip: defineComponent({
      name: 'DesktopOnlyTooltipStub',
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  };
});

vi.mock('./rate-form-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'RateFormDialogStub',
      props: { open: { type: Boolean, default: false }, currency: Object, rate: Object },
      setup(props) {
        return () => (props.open ? h('div', { 'data-testid': 'rate-form-dialog' }) : null);
      },
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: { common: commonEn.common, settings: { ...commonEn.settings, ...currenciesEn.settings } },
  },
});

const buildRate = (patch: Partial<CurrencyRateHistoryItem> = {}): CurrencyRateHistoryItem => ({
  quoteCode: 'USD',
  rate: 1,
  effectiveDate: '2026-10-01',
  source: 'manual',
  writtenAt: '2026-10-01T10:00:00.000Z',
  isInForce: false,
  ...patch,
});

const LATEST = buildRate({ rate: 4, effectiveDate: '2026-10-12', isInForce: true });
const OLDER = buildRate({ rate: 2, effectiveDate: '2026-10-02' });
const SYNCED = buildRate({ rate: 1.5, effectiveDate: '2026-09-20', source: 'coingecko', quoteCode: 'EUR' });

const buildCurrency = ({ savedSource }: { savedSource: CurrencyRateSource }) =>
  ({
    currencyCode: 'USDT',
    currency: { code: 'USDT' },
    quoteCode: 'USD',
    rate: 4,
    quoteRate: 0.25,
    isCustomCurrency: true,
    rateSource: savedSource,
  }) as unknown as CurrencyWithExchangeRate;

const mountList = ({
  rates,
  savedSource = 'manual',
}: {
  rates: CurrencyRateHistoryItem[];
  savedSource?: CurrencyRateSource;
}): VueWrapper =>
  mount(RateList, {
    props: { currency: buildCurrency({ savedSource }), rates },
    global: { plugins: [i18n] },
  });

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="rate-history-row"]');
const texts = (wrapper: VueWrapper, testId: string) =>
  rows(wrapper).map((row) => row.find(`[data-testid="${testId}"]`).text());

describe('RateList', () => {
  it('lists each rate in the given order with the days it is used for and its rate', () => {
    const wrapper = mountList({ rates: [LATEST, OLDER, SYNCED] });

    expect(texts(wrapper, 'rate-history-day')).toEqual([
      'Oct 12, 2026 – now',
      'Oct 2 – Oct 11, 2026',
      'Sep 20 – Oct 1, 2026',
    ]);
    expect(texts(wrapper, 'rate-history-rate')).toEqual(['1 USDT = 4 USD', '1 USDT = 2 USD', '1 USDT = 1.5 EUR']);
  });

  it('marks only the rate in force as current', () => {
    const wrapper = mountList({ rates: [LATEST, OLDER] });

    expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-in-force"]').exists())).toEqual([
      true,
      false,
    ]);
    expect(rows(wrapper)[0]!.find('[data-testid="rate-history-in-force"]').text()).toBe('Current');
  });

  it('shows a one-day range as one date and a range across years with both years', () => {
    const rates = [
      buildRate({ effectiveDate: '2027-01-04', isInForce: true }),
      buildRate({ effectiveDate: '2027-01-03' }),
      buildRate({ effectiveDate: '2026-12-28' }),
    ];
    const wrapper = mountList({ rates });

    expect(texts(wrapper, 'rate-history-day')).toEqual([
      'Jan 4, 2027 – now',
      'Jan 3, 2027',
      'Dec 28, 2026 – Jan 2, 2027',
    ]);
  });

  it('starts the open-ended newest row at its own day even when it is the only rate', () => {
    const wrapper = mountList({ rates: [LATEST] });

    expect(texts(wrapper, 'rate-history-day')).toEqual(['Oct 12, 2026 – now']);
  });

  describe('source chip', () => {
    it('labels only the rows that do not come from the saved source', () => {
      const wrapper = mountList({ rates: [LATEST, SYNCED] });

      expect(rows(wrapper)[0]!.find('[data-testid="rate-history-source"]').exists()).toBe(false);
      expect(rows(wrapper)[1]!.find('[data-testid="rate-history-source"]').text()).toBe('CoinGecko');
    });

    it('always labels the starting rate, apart from the rates the user entered', () => {
      const wrapper = mountList({ rates: [LATEST, buildRate({ source: 'initial' })], savedSource: 'manual' });

      expect(rows(wrapper)[1]!.find('[data-testid="rate-history-source"]').text()).toBe('Starting rate');
    });

    it('labels the rates the user entered once another source is saved', () => {
      const wrapper = mountList({
        rates: [buildRate({ source: 'coingecko', isInForce: true }), OLDER],
        savedSource: 'coingecko',
      });

      expect(rows(wrapper)[0]!.find('[data-testid="rate-history-source"]').exists()).toBe(false);
      expect(rows(wrapper)[1]!.find('[data-testid="rate-history-source"]').text()).toBe('Entered by you');
    });
  });

  describe('editing', () => {
    it('opens the rate form in edit mode for the row, named after its day', async () => {
      const wrapper = mountList({ rates: [LATEST, OLDER] });
      const edit = rows(wrapper)[1]!.find('[data-testid="rate-history-edit"]');

      expect(edit.attributes('aria-label')).toBe('Edit the rate used from Oct 2, 2026');
      expect(wrapper.find('[data-testid="rate-form-dialog"]').exists()).toBe(false);

      await edit.trigger('click');

      const dialog = wrapper.findComponent({ name: 'RateFormDialogStub' });
      expect(wrapper.find('[data-testid="rate-form-dialog"]').exists()).toBe(true);
      expect(dialog.props('rate')).toEqual(OLDER);
      expect(dialog.props('currency')).toEqual(buildCurrency({ savedSource: 'manual' }));
    });

    it('keeps the starting rate and rates quoted in a currency the user does not hold editable', () => {
      const unheld = buildRate({ quoteCode: 'EUR', effectiveDate: '2026-09-01' });
      const wrapper = mountList({ rates: [LATEST, buildRate({ source: 'initial' }), unheld] });

      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-edit"]').exists())).toEqual([
        true,
        true,
        true,
      ]);
    });

    it('gives the rows no actions when the saved source is not manual', () => {
      const wrapper = mountList({ rates: [LATEST, OLDER], savedSource: 'http' });

      expect(wrapper.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
    });
  });
});
