import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyRateHistoryItem, type CurrencyRateSource } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import { RATE_HISTORY_PAGE_LIMIT } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import RecentRates from './recent-rates.vue';

const { mockLoad } = vi.hoisted(() => ({ mockLoad: vi.fn() }));

vi.mock('@/api/currencies', () => ({ loadCurrencyRateHistory: mockLoad }));

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
  const { defineComponent } = await import('vue');
  return { default: defineComponent({ name: 'RateFormDialogStub', render: () => null }) };
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

const buildRates = ({ count, source = 'manual' }: { count: number; source?: CurrencyRateHistoryItem['source'] }) =>
  Array.from({ length: count }, (_, index) =>
    buildRate({
      rate: index + 1,
      effectiveDate: `2026-10-${String(28 - index).padStart(2, '0')}`,
      source,
      isInForce: index === 0,
    }),
  );

const buildCurrency = ({ savedSource }: { savedSource: CurrencyRateSource }) =>
  ({
    currencyCode: 'USDT',
    currency: { code: 'USDT' },
    quoteCode: 'USD',
    rate: 1,
    quoteRate: 1,
    isCustomCurrency: true,
    rateSource: savedSource,
    rateSourceConfig: savedSource === 'peg' ? { pegCurrency: 'USD', factor: 1 } : null,
  }) as unknown as CurrencyWithExchangeRate;

const mountRecent = ({
  savedSource = 'manual',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: { savedSource?: CurrencyRateSource; queryClient?: QueryClient } = {}): VueWrapper => {
  return mount(RecentRates, {
    props: { currency: buildCurrency({ savedSource }) },
    global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] },
  });
};

const mountWith = async ({
  items,
  totalCount = items.length,
  savedSource,
}: {
  items: CurrencyRateHistoryItem[];
  totalCount?: number | null;
  savedSource?: CurrencyRateSource;
}) => {
  mockLoad.mockResolvedValue({ items, totalCount });
  const wrapper = mountRecent({ savedSource });
  await flushPromises();

  return wrapper;
};

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="rate-history-row"]');
const viewAll = (wrapper: VueWrapper) => wrapper.find('[data-testid="recent-rates-view-all"]');

describe('RecentRates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('manual source', () => {
    it('lists the three newest rates, editable, and offers to view all of them', async () => {
      const wrapper = await mountWith({ items: buildRates({ count: 14 }) });

      expect(mockLoad).toHaveBeenCalledWith({ code: 'USDT', limit: RATE_HISTORY_PAGE_LIMIT, offset: 0 });
      expect(wrapper.text()).toContain('Recent rates');
      expect(rows(wrapper)).toHaveLength(3);
      expect(rows(wrapper)[2]!.find('[data-testid="rate-history-day"]').text()).toBe('Oct 26, 2026');
      expect(wrapper.findAll('[data-testid="rate-history-edit"]')).toHaveLength(3);
      expect(wrapper.find('[data-testid="rate-history-note"]').exists()).toBe(false);
      expect(viewAll(wrapper).text()).toBe('View all 14');

      await viewAll(wrapper).trigger('click');
      expect(wrapper.emitted('view-all')).toHaveLength(1);
    });

    it('says "View all" with no count when the API does not know the total', async () => {
      const wrapper = await mountWith({ items: buildRates({ count: 5 }), totalCount: null });

      expect(viewAll(wrapper).text()).toBe('View all');
    });

    it('hides "View all" when every rate is already shown', async () => {
      const wrapper = await mountWith({ items: buildRates({ count: 3 }) });

      expect(rows(wrapper)).toHaveLength(3);
      expect(viewAll(wrapper).exists()).toBe(false);
    });
  });

  it('shows the rates of a synced source read-only, and says how to enter rates instead', async () => {
    const wrapper = await mountWith({ items: buildRates({ count: 4, source: 'coingecko' }), savedSource: 'coingecko' });

    expect(rows(wrapper)).toHaveLength(3);
    expect(wrapper.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
    expect(rows(wrapper)[0]!.find('[data-testid="rate-history-in-force"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rate-history-note"]').text()).toBe(
      "Prices from CoinGecko can't be edited. To enter rates yourself, change where the rate comes from.",
    );
  });

  describe('peg source', () => {
    it('sums up the stored rates in one row instead of listing them, and opens them on View', async () => {
      const wrapper = await mountWith({ items: buildRates({ count: 2 }), savedSource: 'peg' });

      expect(rows(wrapper)).toHaveLength(0);
      expect(wrapper.text()).not.toContain('Recent rates');
      const row = wrapper.find('[data-testid="recent-rates-peg"]');
      expect(row.text()).toContain('Rate history');
      expect(row.find('[data-testid="recent-rates-peg-count"]').text()).toBe('2 rates');
      expect(row.text()).toContain('Not used while USDT follows USD');

      await viewAll(wrapper).trigger('click');
      expect(wrapper.emitted('view-all')).toHaveLength(1);
    });

    it('uses the singular for one rate', async () => {
      const wrapper = await mountWith({ items: buildRates({ count: 1 }), savedSource: 'peg' });

      expect(wrapper.find('[data-testid="recent-rates-peg-count"]').text()).toBe('1 rate');
    });

    it('says there are no stored rates and offers nothing to view when none are kept', async () => {
      const wrapper = await mountWith({ items: [], savedSource: 'peg' });

      expect(wrapper.find('[data-testid="rate-history-empty"]').text()).toBe('No stored rates');
      expect(viewAll(wrapper).exists()).toBe(false);
    });
  });

  it('shows placeholder rows while the rates load', async () => {
    mockLoad.mockReturnValue(new Promise(() => {}));
    const wrapper = mountRecent();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="rate-history-loading"] li')).toHaveLength(3);
    expect(viewAll(wrapper).exists()).toBe(false);
  });

  it('offers a retry when the rates cannot be loaded', async () => {
    mockLoad.mockRejectedValueOnce(
      new ApiErrorResponseError('boom', { code: API_ERROR_CODES.unexpected, message: 'Unexpected' }),
    );
    const wrapper = mountRecent();
    await flushPromises();

    const error = wrapper.find('[data-testid="rate-history-error"]');
    expect(error.text()).toContain("Couldn't load the rates.");
    expect(error.text()).toContain('The current rate above is still correct.');
    expect(rows(wrapper)).toHaveLength(0);

    mockLoad.mockResolvedValue({ items: buildRates({ count: 1 }), totalCount: 1 });
    await wrapper.find('[data-testid="rate-history-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(1);
  });

  it('keeps the rows and offers a retry when refreshing them fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockLoad.mockResolvedValue({ items: buildRates({ count: 2 }), totalCount: 2 });
    const wrapper = mountRecent({ queryClient });
    await flushPromises();
    expect(wrapper.find('[data-testid="rate-history-refresh-error"]').exists()).toBe(false);

    mockLoad.mockRejectedValueOnce(new Error('offline'));
    await queryClient.refetchQueries();
    await flushPromises();

    expect(wrapper.find('[data-testid="rate-history-refresh-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(2);

    mockLoad.mockResolvedValue({ items: buildRates({ count: 3 }), totalCount: 3 });
    await wrapper.find('[data-testid="rate-history-refresh-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="rate-history-refresh-error"]').exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(3);
  });
});
