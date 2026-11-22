import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyRateHistoryItem, type CurrencyRateSource } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import { RATE_HISTORY_PAGE_LIMIT } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import RateHistoryView from './rate-history-view.vue';

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

const buildCurrency = ({ savedSource }: { savedSource: CurrencyRateSource }) =>
  ({
    currencyCode: 'USDT',
    currency: { code: 'USDT' },
    quoteCode: 'USD',
    rate: 4,
    quoteRate: 0.25,
    isCustomCurrency: true,
    rateSource: savedSource,
    rateSourceConfig: savedSource === 'peg' ? { pegCurrency: 'EUR', factor: 1 } : null,
  }) as unknown as CurrencyWithExchangeRate;

const mountView = ({
  savedSource = 'manual',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: { savedSource?: CurrencyRateSource; queryClient?: QueryClient } = {}): VueWrapper => {
  return mount(RateHistoryView, {
    props: { currency: buildCurrency({ savedSource }) },
    global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] },
  });
};

const mountWith = async ({
  items,
  savedSource,
}: {
  items: CurrencyRateHistoryItem[];
  savedSource?: CurrencyRateSource;
}) => {
  mockLoad.mockResolvedValue({ items, totalCount: items.length });
  const wrapper = mountView({ savedSource });
  await flushPromises();

  return wrapper;
};

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="rate-history-row"]');

describe('RateHistoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rows', () => {
    it('lists every loaded rate in the order the API returns them, with its days, source and current mark', async () => {
      const synced = buildRate({ rate: 1.5, effectiveDate: '2026-09-20', source: 'coingecko', quoteCode: 'EUR' });
      const wrapper = await mountWith({ items: [LATEST, OLDER, synced] });

      expect(mockLoad).toHaveBeenCalledWith({ code: 'USDT', limit: RATE_HISTORY_PAGE_LIMIT, offset: 0 });
      expect(wrapper.find('[data-testid="rate-history-count"]').text()).toBe('3 rates, newest first');
      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-rate"]').text())).toEqual([
        '1 USDT = 4 USD',
        '1 USDT = 2 USD',
        '1 USDT = 1.5 EUR',
      ]);
      expect(rows(wrapper)[0]!.find('[data-testid="rate-history-day"]').text()).toBe('Oct 12, 2026 – now');
      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-source"]').exists())).toEqual([
        false,
        false,
        true,
      ]);
      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-in-force"]').exists())).toEqual([
        true,
        false,
        false,
      ]);
    });

    it('uses the singular for one rate', async () => {
      const wrapper = await mountWith({ items: [LATEST] });

      expect(wrapper.find('[data-testid="rate-history-count"]').text()).toBe('1 rate, newest first');
    });

    it('shows an empty state when there are no rates', async () => {
      const wrapper = await mountWith({ items: [] });

      expect(wrapper.find('[data-testid="rate-history-empty"]').text()).toContain('No stored rates');
      expect(rows(wrapper)).toHaveLength(0);
    });

    it('says a currency that follows another needs no stored rates when none are kept', async () => {
      const wrapper = await mountWith({ items: [], savedSource: 'peg' });

      expect(wrapper.find('[data-testid="rate-history-empty"]').text()).toBe(
        "No stored rates. USDT follows EUR, so it doesn't need any.",
      );
    });

    it('offers a retry when the history cannot be loaded', async () => {
      mockLoad.mockRejectedValueOnce(
        new ApiErrorResponseError('boom', { code: API_ERROR_CODES.unexpected, message: 'Unexpected' }),
      );
      const wrapper = mountView();
      await flushPromises();

      expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(true);

      mockLoad.mockResolvedValue({ items: [LATEST], totalCount: 1 });
      await wrapper.find('[data-testid="rate-history-retry"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(false);
      expect(rows(wrapper)).toHaveLength(1);
    });
  });

  describe('Show older rates', () => {
    const buildPage = ({ from, count }: { from: number; count: number }) =>
      Array.from({ length: count }, (_, index) =>
        buildRate({ rate: from + index + 1, effectiveDate: `2026-01-${String(30 - index).padStart(2, '0')}` }),
      );

    it('is hidden when the first page is not full', async () => {
      const wrapper = await mountWith({ items: [LATEST, OLDER] });

      expect(wrapper.find('[data-testid="rate-history-show-more"]').exists()).toBe(false);
    });

    it('requests the next offset and drops the button once a short page arrives', async () => {
      const firstPage = buildPage({ from: 0, count: RATE_HISTORY_PAGE_LIMIT });
      const lastPage = buildPage({ from: RATE_HISTORY_PAGE_LIMIT, count: 3 });
      mockLoad.mockResolvedValueOnce({ items: firstPage, totalCount: 23 });
      const wrapper = mountView();
      await flushPromises();
      expect(rows(wrapper)).toHaveLength(RATE_HISTORY_PAGE_LIMIT);
      expect(wrapper.find('[data-testid="rate-history-count"]').text()).toBe('23 rates, newest first');

      mockLoad.mockResolvedValueOnce({ items: lastPage, totalCount: null });
      await wrapper.find('[data-testid="rate-history-show-more"]').trigger('click');
      await flushPromises();

      expect(mockLoad).toHaveBeenLastCalledWith({
        code: 'USDT',
        limit: RATE_HISTORY_PAGE_LIMIT,
        offset: RATE_HISTORY_PAGE_LIMIT,
      });
      expect(rows(wrapper)).toHaveLength(RATE_HISTORY_PAGE_LIMIT + 3);
      expect(wrapper.find('[data-testid="rate-history-count"]').text()).toBe('23 rates, newest first');
      expect(wrapper.find('[data-testid="rate-history-show-more"]').exists()).toBe(false);
    });

    it('says older rates failed to load and retries the same page', async () => {
      mockLoad.mockResolvedValueOnce({ items: buildPage({ from: 0, count: RATE_HISTORY_PAGE_LIMIT }), totalCount: 23 });
      const wrapper = mountView();
      await flushPromises();

      mockLoad.mockRejectedValueOnce(new Error('offline'));
      await wrapper.find('[data-testid="rate-history-show-more"]').trigger('click');
      await flushPromises();

      const error = wrapper.find('[data-testid="rate-history-older-error"]');
      expect(error.text()).toContain("Couldn't load the rates.");
      expect(wrapper.find('[data-testid="rate-history-show-more"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-refresh-error"]').exists()).toBe(false);
      expect(rows(wrapper)).toHaveLength(RATE_HISTORY_PAGE_LIMIT);

      mockLoad.mockResolvedValueOnce({
        items: buildPage({ from: RATE_HISTORY_PAGE_LIMIT, count: 3 }),
        totalCount: null,
      });
      await wrapper.find('[data-testid="rate-history-older-retry"]').trigger('click');
      await flushPromises();

      expect(mockLoad).toHaveBeenLastCalledWith({
        code: 'USDT',
        limit: RATE_HISTORY_PAGE_LIMIT,
        offset: RATE_HISTORY_PAGE_LIMIT,
      });
      expect(wrapper.find('[data-testid="rate-history-older-error"]').exists()).toBe(false);
      expect(rows(wrapper)).toHaveLength(RATE_HISTORY_PAGE_LIMIT + 3);
    });
  });

  it('keeps the rows and offers a retry when refreshing them fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockLoad.mockResolvedValue({ items: [LATEST, OLDER], totalCount: 2 });
    const wrapper = mountView({ queryClient });
    await flushPromises();

    mockLoad.mockRejectedValueOnce(new Error('offline'));
    await queryClient.refetchQueries();
    await flushPromises();

    expect(wrapper.find('[data-testid="rate-history-refresh-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(2);

    await wrapper.find('[data-testid="rate-history-refresh-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="rate-history-refresh-error"]').exists()).toBe(false);
  });

  describe('manual source', () => {
    it('offers "Update rate", which opens the rate form in add mode', async () => {
      const wrapper = await mountWith({ items: [LATEST, OLDER] });

      expect(wrapper.find('[data-testid="rate-history-note"]').exists()).toBe(false);
      await wrapper.find('[data-testid="rate-history-update"]').trigger('click');

      const dialog = wrapper.findComponent({ name: 'RateFormDialogStub' });
      expect(wrapper.find('[data-testid="rate-form-dialog"]').exists()).toBe(true);
      expect(dialog.props('rate')).toBeUndefined();
    });

    it('lets every row be edited', async () => {
      const wrapper = await mountWith({ items: [LATEST, OLDER] });

      expect(wrapper.findAll('[data-testid="rate-history-edit"]')).toHaveLength(2);
    });
  });

  describe('read-only sources', () => {
    it('gives the rows of a synced source no actions and says they cannot be edited', async () => {
      const wrapper = await mountWith({
        items: [buildRate({ source: 'http', isInForce: true }), buildRate({ source: 'http' })],
        savedSource: 'http',
      });

      expect(wrapper.find('[data-testid="rate-history-note"]').text()).toBe(
        "Prices from Custom URL can't be edited. To enter rates yourself, change where the rate comes from.",
      );
      expect(wrapper.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-update"]').exists()).toBe(false);
      expect(rows(wrapper)[0]!.find('[data-testid="rate-history-in-force"]').exists()).toBe(true);
    });

    it('gives the rates kept while following a currency no actions and no current mark, and says they are unused', async () => {
      const wrapper = await mountWith({ items: [{ ...LATEST, isInForce: false }, OLDER], savedSource: 'peg' });

      expect(rows(wrapper)).toHaveLength(2);
      expect(wrapper.find('[data-testid="rate-history-note"]').text()).toBe('Not used while USDT follows EUR');
      expect(wrapper.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-update"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-in-force"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-empty"]').exists()).toBe(false);
    });
  });
});
