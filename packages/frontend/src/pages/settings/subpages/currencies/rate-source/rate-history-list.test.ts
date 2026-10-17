import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyRateHistoryItem } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import RateHistoryList from './rate-history-list.vue';
import type { EditableRateSource } from './rate-source-draft';
import { RATE_HISTORY_PAGE_LIMIT } from './use-rate-history';

const { mockLoad, mockEdit, mockDelete, mockAddSuccess, mockAddError, mockAddWarning } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockEdit: vi.fn(),
  mockDelete: vi.fn(),
  mockAddSuccess: vi.fn(),
  mockAddError: vi.fn(),
  mockAddWarning: vi.fn(),
}));

vi.mock('@/api/currencies', () => ({
  loadCurrencyRateHistory: mockLoad,
  editUserCurrenciesExchangeRates: mockEdit,
  deleteCustomRate: mockDelete,
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockAddSuccess,
    addErrorNotification: mockAddError,
    addWarningNotification: mockAddWarning,
  }),
}));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

// The user holds USD and USDT; EUR is a currency the user has not connected.
vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currencies: ref([{ currencyCode: 'USD' }, { currencyCode: 'USDT' }]),
    }),
  };
});

// The tooltip needs its provider and has no part in these cases.
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

// The dialogs' own chrome (drawer on mobile) is not under test: both render their slots while open.
vi.mock('@/components/common/responsive-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveDialogStub',
      props: { open: { type: Boolean, default: false } },
      setup(props, { slots }) {
        return () => (props.open ? h('div', {}, [slots.default?.(), slots.footer?.()]) : null);
      },
    }),
  };
});

vi.mock('@/components/common/responsive-alert-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveAlertDialogStub',
      props: { open: { type: Boolean, default: false } },
      emits: ['update:open', 'confirm'],
      setup(props, { emit, slots }) {
        return () =>
          props.open
            ? h('div', {}, [
                slots.description?.(),
                h('button', { 'data-testid': 'confirm', onClick: () => emit('confirm') }),
              ])
            : null;
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

const mountList = ({ savedSource = 'manual' }: { savedSource?: EditableRateSource } = {}): VueWrapper => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  return mount(RateHistoryList, {
    props: { code: 'USDT', savedSource, isFormDisabled: false },
    global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] },
  });
};

const mountWith = async ({
  items,
  savedSource,
}: {
  items: CurrencyRateHistoryItem[];
  savedSource?: EditableRateSource;
}) => {
  mockLoad.mockResolvedValue({ items, totalCount: items.length });
  const wrapper = mountList({ savedSource });
  await flushPromises();

  return wrapper;
};

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="rate-history-row"]');

describe('RateHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEdit.mockResolvedValue({ rates: [], remeasure: { failed: 0 } });
    mockDelete.mockResolvedValue({ remeasure: { failed: 0 } });
  });

  describe('rows', () => {
    it('lists each rate in the order the API returns them, with its start day, source and in-force mark', async () => {
      const synced = buildRate({ rate: 1.5, effectiveDate: '2026-09-20', source: 'coingecko', quoteCode: 'EUR' });
      const wrapper = await mountWith({ items: [LATEST, OLDER, synced] });

      expect(mockLoad).toHaveBeenCalledWith({ code: 'USDT', limit: RATE_HISTORY_PAGE_LIMIT, offset: 0 });
      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-rate"]').text())).toEqual([
        '1 USDT = 4 USD',
        '1 USDT = 2 USD',
        '1 USDT = 1.5 EUR',
      ]);
      expect(rows(wrapper)[0]!.find('[data-testid="rate-history-day"]').text()).toBe('From Oct 12, 2026');
      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-source"]').text())).toEqual([
        'Manual',
        'Manual',
        'CoinGecko',
      ]);
      expect(rows(wrapper).map((row) => row.find('[data-testid="rate-history-in-force"]').exists())).toEqual([
        true,
        false,
        false,
      ]);
    });

    it('shows an empty state when there are no rates', async () => {
      const wrapper = await mountWith({ items: [] });

      expect(wrapper.find('[data-testid="rate-history-empty"]').text()).toContain('No rates yet');
      expect(rows(wrapper)).toHaveLength(0);
    });

    it('says a pegged currency stores no rates when none are kept', async () => {
      const wrapper = await mountWith({ items: [], savedSource: 'peg' });

      expect(wrapper.find('[data-testid="rate-history-empty"]').text()).toContain(
        'USDT is valued by its peg and stores no rates.',
      );
    });

    it('offers a retry when the history cannot be loaded', async () => {
      mockLoad.mockRejectedValueOnce(
        new ApiErrorResponseError('boom', { code: API_ERROR_CODES.unexpected, message: 'Unexpected' }),
      );
      const wrapper = mountList();
      await flushPromises();

      expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(true);

      mockLoad.mockResolvedValue({ items: [LATEST], totalCount: 1 });
      await wrapper.find('[data-testid="rate-history-retry"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="rate-history-error"]').exists()).toBe(false);
      expect(rows(wrapper)).toHaveLength(1);
    });
  });

  describe('Show more', () => {
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
      const wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)).toHaveLength(RATE_HISTORY_PAGE_LIMIT);

      mockLoad.mockResolvedValueOnce({ items: lastPage, totalCount: null });
      await wrapper.find('[data-testid="rate-history-show-more"]').trigger('click');
      await flushPromises();

      expect(mockLoad).toHaveBeenLastCalledWith({
        code: 'USDT',
        limit: RATE_HISTORY_PAGE_LIMIT,
        offset: RATE_HISTORY_PAGE_LIMIT,
      });
      expect(rows(wrapper)).toHaveLength(RATE_HISTORY_PAGE_LIMIT + 3);
      expect(wrapper.find('[data-testid="rate-history-show-more"]').exists()).toBe(false);
    });
  });

  describe('manual source', () => {
    it('edits a rate through both directions of its pair, with the row’s day, and reloads the list', async () => {
      const wrapper = await mountWith({ items: [LATEST, OLDER] });

      await rows(wrapper)[1]!.find('[data-testid="rate-history-edit"]').trigger('click');
      expect(wrapper.find('[data-testid="edit-dated-rate-save"]').attributes('disabled')).toBeDefined();

      await wrapper
        .find('input[data-testid="edit-dated-rate-base"], [data-testid="edit-dated-rate-base"] input')
        .setValue('8');
      expect(wrapper.find('[data-testid="edit-dated-rate-save"]').attributes('disabled')).toBeUndefined();
      mockLoad.mockClear();
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockEdit).toHaveBeenCalledWith([
        { baseCode: 'USDT', quoteCode: 'USD', rate: 8, effectiveDate: '2026-10-02' },
        { baseCode: 'USD', quoteCode: 'USDT', rate: 0.125, effectiveDate: '2026-10-02' },
      ]);
      expect(mockAddSuccess).toHaveBeenCalledWith('Rate updated');
      expect(wrapper.emitted('changed')).toHaveLength(1);
      expect(mockLoad).toHaveBeenCalledTimes(1);
      expect(wrapper.find('form').exists()).toBe(false);
    });

    it('derives the rate from the opposite direction when that field is typed', async () => {
      const wrapper = await mountWith({ items: [LATEST] });

      await rows(wrapper)[0]!.find('[data-testid="rate-history-edit"]').trigger('click');
      await wrapper
        .find('input[data-testid="edit-dated-rate-quote"], [data-testid="edit-dated-rate-quote"] input')
        .setValue('0.5');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockEdit.mock.calls[0]![0]).toEqual([
        { baseCode: 'USDT', quoteCode: 'USD', rate: 2, effectiveDate: '2026-10-12' },
        { baseCode: 'USD', quoteCode: 'USDT', rate: 0.5, effectiveDate: '2026-10-12' },
      ]);
    });

    it('keeps the dialog open and reports the refusal when the edit fails', async () => {
      mockEdit.mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Rate refused' }),
      );
      const wrapper = await mountWith({ items: [LATEST] });

      await rows(wrapper)[0]!.find('[data-testid="rate-history-edit"]').trigger('click');
      await wrapper
        .find('input[data-testid="edit-dated-rate-base"], [data-testid="edit-dated-rate-base"] input')
        .setValue('9');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockAddError).toHaveBeenCalledWith('Rate refused');
      expect(wrapper.find('form').exists()).toBe(true);
      expect(wrapper.emitted('changed')).toBeUndefined();
    });

    it('removes a rate through both directions of its pair, with the row’s day, and reloads the list', async () => {
      const wrapper = await mountWith({ items: [LATEST, OLDER] });

      await rows(wrapper)[1]!.find('[data-testid="rate-history-remove"]').trigger('click');
      expect(wrapper.text()).toContain('Removes the rate of USDT that starts on Oct 2, 2026.');
      mockLoad.mockClear();
      await wrapper.find('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockDelete).toHaveBeenCalledWith([
        { baseCode: 'USDT', quoteCode: 'USD', effectiveDate: '2026-10-02' },
        { baseCode: 'USD', quoteCode: 'USDT', effectiveDate: '2026-10-02' },
      ]);
      expect(mockAddSuccess).toHaveBeenCalledWith('Rate removed');
      expect(wrapper.emitted('changed')).toHaveLength(1);
      expect(mockLoad).toHaveBeenCalledTimes(1);
    });

    it('lets a rate quoted in a currency the user does not hold be removed but not edited', async () => {
      const unheld = buildRate({ quoteCode: 'EUR', rate: 0.9, effectiveDate: '2026-09-01', source: 'coingecko' });
      const wrapper = await mountWith({ items: [LATEST, unheld] });

      const [held, other] = rows(wrapper);
      expect(held!.find('[data-testid="rate-history-edit"]').exists()).toBe(true);
      expect(held!.find('[data-testid="rate-history-connect-note"]').exists()).toBe(false);
      expect(other!.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
      expect(other!.find('[data-testid="rate-history-remove"]').exists()).toBe(true);
      expect(other!.find('[data-testid="rate-history-connect-note"]').text()).toBe('Connect EUR to edit this rate.');

      await other!.find('[data-testid="rate-history-remove"]').trigger('click');
      await wrapper.find('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockDelete).toHaveBeenCalledWith([
        { baseCode: 'USDT', quoteCode: 'EUR', effectiveDate: '2026-09-01' },
        { baseCode: 'EUR', quoteCode: 'USDT', effectiveDate: '2026-09-01' },
      ]);
    });
  });

  describe('read-only sources', () => {
    it('gives the rows of a synced source no actions and says the sync keeps them', async () => {
      const wrapper = await mountWith({
        items: [buildRate({ source: 'coingecko', isInForce: true }), buildRate({ source: 'coingecko' })],
        savedSource: 'coingecko',
      });

      expect(wrapper.find('[data-testid="rate-history-note"]').text()).toBe(
        'The CoinGecko source keeps these rates up to date, so they are read-only here.',
      );
      expect(wrapper.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-remove"]').exists()).toBe(false);
      expect(rows(wrapper)[0]!.find('[data-testid="rate-history-in-force"]').exists()).toBe(true);
    });

    it('gives the manual rates kept under a peg no actions and no in-force mark, and says they are inactive', async () => {
      const wrapper = await mountWith({ items: [{ ...LATEST, isInForce: false }, OLDER], savedSource: 'peg' });

      expect(rows(wrapper)).toHaveLength(2);
      expect(wrapper.find('[data-testid="rate-history-note"]').text()).toBe(
        'These manual rates are inactive while USDT is pegged. They apply again if the source goes back to Manual.',
      );
      expect(wrapper.find('[data-testid="rate-history-edit"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-remove"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-in-force"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-empty"]').exists()).toBe(false);
    });
  });
});
