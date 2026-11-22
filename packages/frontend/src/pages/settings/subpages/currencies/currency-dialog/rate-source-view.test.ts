import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type UpdateCurrencyRateSourceBody, type UserCurrencyModel } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { DOMWrapper, type VueWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { merge } from 'lodash-es';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import RateSourceView from './rate-source-view.vue';

const { mockUpdate, mockTest, mockSearch, mockAddSuccess, mockRefresh, mockLoadHistory } = vi.hoisted(() => ({
  mockLoadHistory: vi.fn(),
  mockUpdate: vi.fn(),
  mockTest: vi.fn(),
  mockSearch: vi.fn(),
  mockAddSuccess: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/api/currencies', () => ({
  loadCurrencyRateHistory: mockLoadHistory,
  updateCurrencyRateSource: mockUpdate,
  testCurrencyRateSource: mockTest,
  searchCoingeckoCoins: mockSearch,
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: mockAddSuccess, addErrorNotification: vi.fn() }),
}));

vi.mock('../use-refresh-after-currency-change', () => ({
  useRefreshAfterCurrencyChange: () => mockRefresh,
}));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currencies: ref([
        { currencyCode: 'USD', currency: { currency: 'US Dollar', isCustom: false } },
        { currencyCode: 'EUR', currency: { currency: 'Euro', isCustom: false } },
        { currencyCode: 'USDT', currency: { currency: 'Tether', isCustom: true } },
        { currencyCode: 'USDC', currency: { currency: 'USD Coin', isCustom: true } },
      ]),
      isoCurrencies: ref([
        { code: 'USD', currency: 'US Dollar' },
        { code: 'EUR', currency: 'Euro' },
      ]),
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

vi.mock('@/components/common/hint-icon.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'HintIconStub',
      props: { content: { type: String, required: true } },
      setup: (props) => () => h('span', { 'data-hint': props.content }),
    }),
  };
});

// A native select stands in for the searchable reka-ui select: it emits the option object.
vi.mock('@/components/fields/select-field.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'SelectFieldStub',
      inheritAttrs: false,
      props: ['modelValue', 'values', 'label', 'errorMessage', 'disabled'],
      emits: ['update:modelValue'],
      setup(props, { emit, attrs }) {
        return () =>
          h('div', {}, [
            h(
              'select',
              {
                'data-testid': attrs['data-testid'],
                value: props.modelValue?.value ?? '',
                disabled: props.disabled,
                onChange: (event: Event) => {
                  const value = (event.target as HTMLSelectElement).value;
                  emit(
                    'update:modelValue',
                    props.values.find((item: { value: string }) => item.value === value) ?? null,
                  );
                },
              },
              [
                h('option', { value: '' }),
                ...props.values.map((item: { value: string; label: string }) =>
                  h('option', { value: item.value }, item.label),
                ),
              ],
            ),
            props.errorMessage ? h('p', { 'data-testid': 'select-error' }, props.errorMessage) : null,
          ]);
      },
    }),
  };
});

const SEARCH_DEBOUNCE_MS = 300;
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: merge({}, commonEn, currenciesEn, {
      settings: {
        currencies: {
          dialog: { sourceView: { note: { coingecko: 'COINGECKO-NOTE', coingeckoCoinChanged: 'COIN-CHANGED' } } },
        },
      },
    }),
  },
});

const buildCurrency = (patch: Partial<UserCurrencyModel> = {}): CurrencyWithExchangeRate =>
  ({
    id: 1,
    userId: 1,
    currencyCode: 'BTC',
    exchangeRate: 1,
    liveRateUpdate: false,
    isDefaultCurrency: false,
    nameOverride: null,
    symbolOverride: null,
    decimalsOverride: null,
    rateSource: 'manual',
    rateSourceConfig: null,
    currency: { code: 'BTC', currency: 'Bitcoin', isCustom: true },
    name: 'Bitcoin',
    isCustomCurrency: true,
    rate: 50000,
    quoteCode: 'USD',
    quoteRate: 0.00002,
    ...patch,
  }) as unknown as CurrencyWithExchangeRate;

const mountView = ({ currency = buildCurrency() }: { currency?: CurrencyWithExchangeRate } = {}) =>
  mount(RateSourceView, {
    props: { currency },
    global: {
      plugins: [
        i18n,
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
            }),
          },
        ],
      ],
    },
  });

const selectSource = async ({ wrapper, source }: { wrapper: VueWrapper; source: string }) => {
  await wrapper.find(`[data-testid="rate-source-radio-${source}"]`).trigger('click');
};

const setInput = async ({ wrapper, testId, value }: { wrapper: VueWrapper; testId: string; value: string }) => {
  await wrapper.find(`input[data-testid="${testId}"], [data-testid="${testId}"] input`).setValue(value);
};

const save = async ({ wrapper }: { wrapper: VueWrapper }) => {
  await wrapper.find('[data-testid="rate-source-save"]').trigger('click');
  await flushPromises();
};

const isSaveDisabled = ({ wrapper }: { wrapper: VueWrapper }) =>
  wrapper.find('[data-testid="rate-source-save"]').attributes('disabled') !== undefined;

const lastDirty = ({ wrapper }: { wrapper: VueWrapper }) => wrapper.emitted<[boolean]>('update:dirty')?.at(-1)?.[0];

// jsdom lacks scrollIntoView, which reka-ui calls on the highlighted option.
Element.prototype.scrollIntoView = vi.fn();
enableAutoUnmount(afterEach);

describe('RateSourceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockLoadHistory.mockResolvedValue({
      items: [{ effectiveDate: '2026-10-12', rate: 1, quoteCode: 'USD', source: 'manual' }],
      totalCount: 1,
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    // The API answers with the saved source; the header values are never part of it, only their names.
    mockUpdate.mockImplementation(async ({ body }: { body: UpdateCurrencyRateSourceBody }) => {
      if (body.rateSource !== 'http')
        return {
          currencyCode: 'BTC',
          ...body,
          rateSourceConfig: null,
          ...('config' in body ? { rateSourceConfig: body.config } : {}),
        };

      const { headers, ...config } = body.config;

      return {
        currencyCode: 'BTC',
        rateSource: 'http',
        rateSourceConfig: { quoteCurrency: 'USD', ...config, headerNames: Object.keys(headers ?? {}) },
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('options', () => {
    it('offers the four sources as one radio group, in order, with the saved one in use', () => {
      const wrapper = mountView({
        currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1 } }),
      });

      const radios = wrapper.findAll('[data-testid="rate-source-options"] [role="radio"]');
      expect(radios.map((radio) => radio.attributes('value'))).toEqual(['manual', 'peg', 'coingecko', 'http']);
      expect(wrapper.find('[data-testid="rate-source-radio-peg"]').attributes('aria-checked')).toBe('true');
      expect(wrapper.find('[data-testid="rate-source-option-peg"] [data-testid="rate-source-in-use"]').exists()).toBe(
        true,
      );
      expect(wrapper.findAll('[data-testid="rate-source-in-use"]')).toHaveLength(1);
    });

    it('keeps Save disabled and the draft clean while nothing changed', () => {
      const wrapper = mountView();

      expect(isSaveDisabled({ wrapper })).toBe(true);
      expect(wrapper.find('[data-testid="rate-source-dirty"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-source-note"]').exists()).toBe(false);
      expect(lastDirty({ wrapper })).toBe(false);
    });

    it('reports a draft as dirty and leaves it on Cancel without saving', async () => {
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'peg' });
      expect(lastDirty({ wrapper })).toBe(true);
      expect(wrapper.find('[data-testid="rate-source-dirty"]').exists()).toBe(true);

      await wrapper.find('[data-testid="rate-source-cancel"]').trigger('click');

      expect(wrapper.emitted('cancel')).toHaveLength(1);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('shows the once-a-day hint only on a selected crypto price or custom URL', async () => {
      const wrapper = mountView();
      const hint = (source: string) => wrapper.find(`[data-testid="rate-source-schedule-${source}"]`);

      expect(['manual', 'peg', 'coingecko', 'http'].some((source) => hint(source).exists())).toBe(false);

      await selectSource({ wrapper, source: 'coingecko' });
      expect(hint('coingecko').exists()).toBe(true);
      expect(hint('http').exists()).toBe(false);

      await selectSource({ wrapper, source: 'http' });
      expect(hint('http').exists()).toBe(true);
      expect(hint('coingecko').exists()).toBe(false);
    });
  });

  describe('manual source', () => {
    it('saves the manual source when another source is saved, and says what happens', async () => {
      const wrapper = mountView({
        currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1 } }),
      });

      await selectSource({ wrapper, source: 'manual' });
      expect(wrapper.find('[data-testid="rate-source-note"]').exists()).toBe(true);

      await save({ wrapper });

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'BTC', body: { rateSource: 'manual' } });
      expect(wrapper.emitted('saved')).toHaveLength(1);
    });

    it('blocks leaving a peg for manual entry while the currency has no stored rate', async () => {
      mockLoadHistory.mockResolvedValue({ items: [], totalCount: 0 });
      const wrapper = mountView({
        currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1 } }),
      });
      await flushPromises();

      await selectSource({ wrapper, source: 'manual' });

      expect(wrapper.get('[data-testid="rate-source-note"]').text()).toContain(
        'has no stored rates yet. Follow a currency or connect a price first.',
      );
      expect(isSaveDisabled({ wrapper })).toBe(true);
    });
  });

  describe('peg source', () => {
    it('saves the peg currency and factor, offers only the held ISO currencies and refreshes after saving', async () => {
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'peg' });
      const values = wrapper
        .findAll('[data-testid="rate-source-peg-currency"] option')
        .map((item) => item.attributes('value'))
        .filter(Boolean);
      expect(values).toEqual(['USD', 'EUR']);

      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('USD');
      await setInput({ wrapper, testId: 'rate-source-peg-factor', value: '0.5' });
      expect(wrapper.find('[data-testid="rate-source-peg-target"]').text()).toBe('USD');
      await save({ wrapper });

      expect(mockUpdate).toHaveBeenCalledWith({
        code: 'BTC',
        body: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 0.5 } },
      });
      expect(mockAddSuccess).toHaveBeenCalledWith('Rate source saved');
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted('saved')).toHaveLength(1);
    });

    it('refuses a missing peg currency and a factor that is not positive, without calling the API', async () => {
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'peg' });
      await setInput({ wrapper, testId: 'rate-source-peg-factor', value: '0' });
      await save({ wrapper });

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Select the currency to peg to');
      expect(wrapper.text()).toContain('Enter a number above 0');
      expect(wrapper.emitted('saved')).toBeUndefined();
    });

    it('seeds the form from the saved peg and keeps Save disabled until something changes', async () => {
      const wrapper = mountView({
        currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 2 } }),
      });

      expect(
        (
          wrapper.find('input[data-testid="rate-source-peg-factor"], [data-testid="rate-source-peg-factor"] input')
            .element as HTMLInputElement
        ).value,
      ).toBe('2');
      expect(isSaveDisabled({ wrapper })).toBe(true);

      await setInput({ wrapper, testId: 'rate-source-peg-factor', value: '3' });

      expect(isSaveDisabled({ wrapper })).toBe(false);
      expect(lastDirty({ wrapper })).toBe(true);
    });
  });

  describe('coingecko source', () => {
    const COIN = {
      coinId: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      logoUrl: 'https://img.test/btc.png',
      marketCapRank: 1,
    };

    it('saves the logo of the picked coin with the source and refreshes the currencies', async () => {
      vi.useFakeTimers();
      try {
        mockSearch.mockResolvedValue([COIN]);
        const wrapper = mountView();

        await selectSource({ wrapper, source: 'coingecko' });
        await setInput({ wrapper, testId: 'rate-source-coin-search', value: 'bit' });
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
        await flushPromises();
        await new DOMWrapper(document.body).find('[data-testid="rate-source-coin-bitcoin"]').trigger('click');
        await save({ wrapper });

        expect(mockUpdate).toHaveBeenCalledWith({
          code: 'BTC',
          body: {
            rateSource: 'coingecko',
            config: { coinId: 'bitcoin', quoteCurrency: 'USD' },
            logoUrl: 'https://img.test/btc.png',
          },
        });
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('saved')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sends no logo for a saved coin the user did not pick again', async () => {
      const wrapper = mountView({
        currency: buildCurrency({
          rateSource: 'coingecko',
          rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
        }),
      });

      await wrapper.find('[data-testid="rate-source-coingecko-quote"]').setValue('EUR');
      await save({ wrapper });

      expect(mockUpdate).toHaveBeenCalledWith({
        code: 'BTC',
        body: { rateSource: 'coingecko', config: { coinId: 'bitcoin', quoteCurrency: 'EUR' } },
      });
    });

    it("says the previous coin's prices are removed only when another coin replaces the saved one", async () => {
      vi.useFakeTimers();
      try {
        mockSearch.mockResolvedValue([{ ...COIN, coinId: 'tether', symbol: 'usdt', name: 'Tether' }]);
        const wrapper = mountView({
          currency: buildCurrency({
            rateSource: 'coingecko',
            rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
          }),
        });

        await wrapper.find('[data-testid="rate-source-coingecko-quote"]').setValue('EUR');
        expect(wrapper.find('[data-testid="rate-source-note"]').text()).toBe('COINGECKO-NOTE');

        await setInput({ wrapper, testId: 'rate-source-coin-search', value: 'teth' });
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
        await flushPromises();
        await new DOMWrapper(document.body).find('[data-testid="rate-source-coin-tether"]').trigger('click');

        expect(wrapper.find('[data-testid="rate-source-note"]').text()).toBe('COINGECKO-NOTE COIN-CHANGED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks CoinGecko unavailable when the coin search says the instance has no key', async () => {
      vi.useFakeTimers();
      try {
        mockSearch.mockRejectedValue(
          new ApiErrorResponseError('not configured', {
            code: API_ERROR_CODES.cryptoProviderNotConfigured,
            message: 'Crypto search is unavailable',
          }),
        );
        const wrapper = mountView();

        await selectSource({ wrapper, source: 'coingecko' });
        await setInput({ wrapper, testId: 'rate-source-coin-search', value: 'bit' });
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
        await flushPromises();

        expect(wrapper.find('[data-testid="rate-source-not-configured"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="rate-source-not-available"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="rate-source-coingecko-form"]').exists()).toBe(false);
        expect(isSaveDisabled({ wrapper })).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('saving', () => {
    it('locks the options and the fields while saving and says the price is being fetched', async () => {
      let finish: (value: unknown) => void = () => {};
      mockUpdate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'http' });
      await setInput({ wrapper, testId: 'rate-source-http-url', value: 'https://api.example.com/price?id={code}' });
      await setInput({ wrapper, testId: 'rate-source-http-path', value: 'data.price' });
      await wrapper.find('[data-testid="rate-source-save"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="rate-source-radio-manual"]').attributes('disabled')).toBeDefined();
      expect(
        wrapper
          .find('input[data-testid="rate-source-http-path"], [data-testid="rate-source-http-path"] input')
          .attributes('disabled'),
      ).toBeDefined();
      expect(wrapper.find('[data-testid="rate-source-cancel"]').attributes('disabled')).toBeDefined();
      expect(wrapper.find('[data-testid="rate-source-fetching"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="rate-source-dirty"]').exists()).toBe(false);
      expect(lastDirty({ wrapper })).toBe(true);
      expect(wrapper.emitted<[boolean]>('update:saving')?.at(-1)?.[0]).toBe(true);

      finish({ currencyCode: 'BTC', rateSource: 'manual', rateSourceConfig: null });
      await flushPromises();

      expect(wrapper.emitted('saved')).toHaveLength(1);
    });
  });

  describe('after a save', () => {
    it('reports a clean draft before saved while the reload replaces the currency', async () => {
      const wrapper = mountView();
      mockRefresh.mockImplementation(async () => {
        await wrapper.setProps({
          currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 2 } }),
        });
      });
      const dirtyWhenSaved: (boolean | undefined)[] = [];
      await wrapper.setProps({ onSaved: () => dirtyWhenSaved.push(lastDirty({ wrapper })) } as never);

      await selectSource({ wrapper, source: 'peg' });
      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('USD');
      await setInput({ wrapper, testId: 'rate-source-peg-factor', value: '2' });
      await save({ wrapper });

      expect(dirtyWhenSaved).toEqual([false]);
      expect(lastDirty({ wrapper })).toBe(false);
      expect(isSaveDisabled({ wrapper })).toBe(true);
      expect(wrapper.find('[data-testid="rate-source-radio-peg"]').attributes('aria-checked')).toBe('true');
    });
  });

  describe('save failures', () => {
    it('marks CoinGecko unavailable when a save says the instance has no key, and blocks saving it', async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('not configured', {
          code: API_ERROR_CODES.cryptoProviderNotConfigured,
          message: 'Crypto provider is not configured',
        }),
      );
      const wrapper = mountView({
        currency: buildCurrency({
          rateSource: 'coingecko',
          rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
        }),
      });

      await wrapper.find('[data-testid="rate-source-coingecko-quote"]').setValue('EUR');
      await save({ wrapper });

      expect(wrapper.find('[data-testid="rate-source-not-configured"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="rate-source-error"]').exists()).toBe(false);
      expect(isSaveDisabled({ wrapper })).toBe(true);
      expect(wrapper.emitted('saved')).toBeUndefined();

      await selectSource({ wrapper, source: 'manual' });

      expect(isSaveDisabled({ wrapper })).toBe(false);
    });

    it('releases the lock once a save fails', async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'No EUR rate yet' }),
      );
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'peg' });
      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('EUR');
      await save({ wrapper });

      expect(wrapper.emitted<[boolean]>('update:saving')?.map(([value]) => value)).toEqual([true, false]);
      expect(wrapper.find('[data-testid="rate-source-radio-manual"]').attributes('disabled')).toBeUndefined();
      expect(wrapper.find('[data-testid="rate-source-cancel"]').attributes('disabled')).toBeUndefined();
    });

    it('leaves a 401 to the API client and shows no error of its own', async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('unauthorized', { code: API_ERROR_CODES.unauthorized, message: 'Unauthorized' }),
      );
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'peg' });
      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('EUR');
      await save({ wrapper });

      expect(wrapper.find('[data-testid="rate-source-error"]').exists()).toBe(false);
      expect(wrapper.emitted('saved')).toBeUndefined();
    });

    it("shows the API's explanation of a refusal and offers to try again", async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'No EUR rate yet' }),
      );
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'peg' });
      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('EUR');
      await save({ wrapper });

      expect(wrapper.find('[data-testid="rate-source-error"]').text()).toContain('No EUR rate yet');
      expect(wrapper.find('[data-testid="rate-source-save"]').text()).toBe('Try again');
      expect(wrapper.emitted('saved')).toBeUndefined();
    });
  });

  describe('http source', () => {
    const URL_TEMPLATE = 'https://api.example.com/price?id={code}';

    const fillHttp = async ({ wrapper }: { wrapper: VueWrapper }) => {
      await selectSource({ wrapper, source: 'http' });
      await setInput({ wrapper, testId: 'rate-source-http-url', value: URL_TEMPLATE });
      await setInput({ wrapper, testId: 'rate-source-http-path', value: 'data.price' });
    };

    it('saves the URL, path and quote currency, and typed headers as the new set', async () => {
      const wrapper = mountView();

      await fillHttp({ wrapper });
      await wrapper.find('[data-testid="rate-source-add-header"]').trigger('click');
      await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-Api-Key');
      await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('secret');
      await save({ wrapper });

      expect(mockUpdate).toHaveBeenCalledWith({
        code: 'BTC',
        body: {
          rateSource: 'http',
          config: {
            urlTemplate: URL_TEMPLATE,
            jsonPath: 'data.price',
            quoteCurrency: 'USD',
            headers: { 'X-Api-Key': 'secret' },
          },
        },
      });
    });

    it('shows why the first fetch failed and does not report the source as saved', async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('bad', {
          code: API_ERROR_CODES.validationError,
          message: 'No rate for BTC',
          details: { reason: 'http_status' },
        }),
      );
      const wrapper = mountView();

      await fillHttp({ wrapper });
      await save({ wrapper });

      expect(wrapper.find('[data-testid="rate-source-error"]').text()).toContain('No rate for BTC');
      expect(wrapper.find('[data-testid="rate-source-error-reason"]').exists()).toBe(true);
      expect(mockAddSuccess).not.toHaveBeenCalled();
      expect(wrapper.emitted('saved')).toBeUndefined();
    });

    it('masks header values while they are typed', async () => {
      const wrapper = mountView();

      await selectSource({ wrapper, source: 'http' });
      await wrapper.find('[data-testid="rate-source-add-header"]').trigger('click');

      expect(wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.attributes('type')).toBe('password');
    });

    describe('with saved headers', () => {
      const savedHttp = () =>
        buildCurrency({
          rateSource: 'http',
          rateSourceConfig: {
            urlTemplate: URL_TEMPLATE,
            jsonPath: 'data.price',
            quoteCurrency: 'USD',
            headerNames: ['X-Api-Key', 'Accept'],
          },
        });

      it('lists the saved header names, never values, and leaves them out of an unrelated save', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').text()).toContain('X-Api-Key, Accept');
        expect(wrapper.find('[data-testid="rate-source-header-row-0"]').exists()).toBe(false);

        await setInput({ wrapper, testId: 'rate-source-http-path', value: 'data.rate' });
        await save({ wrapper });

        const body = mockUpdate.mock.calls[0]![0].body;
        expect(body.config.jsonPath).toBe('data.rate');
        expect('headers' in body.config).toBe(false);
      });

      it('removes the saved headers when they are replaced with no rows', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        expect(wrapper.find('[data-testid="rate-source-headers-removed"]').exists()).toBe(true);
        await save({ wrapper });

        expect(mockUpdate.mock.calls[0]![0].body.config.headers).toEqual({});
      });

      it('requires replacing them before a URL on another origin is saved, as the API sends them nowhere else', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        await setInput({ wrapper, testId: 'rate-source-http-url', value: 'https://api.other.com/price?id={code}' });
        expect(wrapper.find('[data-testid="rate-source-headers-origin-changed"]').exists()).toBe(true);
        await save({ wrapper });
        expect(mockUpdate).not.toHaveBeenCalled();

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        expect(wrapper.find('[data-testid="rate-source-cancel-replace-headers"]').exists()).toBe(false);
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-Api-Key');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('other-secret');
        await save({ wrapper });

        expect(mockUpdate.mock.calls[0]![0].body.config.headers).toEqual({ 'X-Api-Key': 'other-secret' });
      });

      it('replaces them with the typed rows', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('Authorization');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('Bearer x');
        await save({ wrapper });

        expect(mockUpdate.mock.calls[0]![0].body.config.headers).toEqual({ Authorization: 'Bearer x' });
      });

      it('can back out of replacing them to keep the saved ones', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-cancel-replace-headers"]').trigger('click');

        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').exists()).toBe(true);
        expect(isSaveDisabled({ wrapper })).toBe(true);
      });

      it('shows the names the API returned and drops the typed values after a save', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-New');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('top-secret');
        await save({ wrapper });

        await wrapper.setProps({
          currency: buildCurrency({
            rateSource: 'http',
            rateSourceConfig: {
              urlTemplate: URL_TEMPLATE,
              jsonPath: 'data.price',
              quoteCurrency: 'USD',
              headerNames: ['X-New'],
            },
          }),
        });

        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').text()).toContain('X-New');
        expect(wrapper.html()).not.toContain('top-secret');
      });

      it('resets the draft after new values for headers with the same names, which change nothing public', async () => {
        const wrapper = mountView({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-Api-Key');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('rotated-secret');
        mockUpdate.mockResolvedValueOnce({
          currencyCode: 'BTC',
          rateSource: 'http',
          rateSourceConfig: savedHttp().rateSourceConfig,
        });
        await save({ wrapper });

        // The saved source is the one it was before, so the view must not keep the typed secret.
        expect(isSaveDisabled({ wrapper })).toBe(true);
        expect(wrapper.find('[data-testid="rate-source-header-row-0"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').text()).toContain('X-Api-Key');
        expect(wrapper.html()).not.toContain('rotated-secret');
      });
    });

    describe('Test button', () => {
      it('is disabled until the URL and path are filled', async () => {
        const wrapper = mountView();

        await selectSource({ wrapper, source: 'http' });
        expect(wrapper.find('[data-testid="rate-source-test"]').attributes('disabled')).toBeDefined();

        await setInput({ wrapper, testId: 'rate-source-http-url', value: URL_TEMPLATE });
        await setInput({ wrapper, testId: 'rate-source-http-path', value: 'data.price' });
        expect(wrapper.find('[data-testid="rate-source-test"]').attributes('disabled')).toBeUndefined();
      });

      it('previews the rate without saving', async () => {
        mockTest.mockResolvedValue({ ok: true, date: '2026-10-17', rate: 67123.45, quoteCurrency: 'USD' });
        const wrapper = mountView();

        await fillHttp({ wrapper });
        await wrapper.find('[data-testid="rate-source-test"]').trigger('click');
        await flushPromises();

        expect(mockTest).toHaveBeenCalledWith({
          code: 'BTC',
          body: {
            rateSource: 'http',
            config: { urlTemplate: URL_TEMPLATE, jsonPath: 'data.price', quoteCurrency: 'USD', headers: {} },
          },
        });
        expect(wrapper.find('[data-testid="rate-source-test-success"]').text()).toBe(
          'On 2026-10-17, 1 BTC = 67,123.45 USD',
        );
        expect(mockUpdate).not.toHaveBeenCalled();
      });

      it('shows why a request failed, with the API message', async () => {
        mockTest.mockResolvedValue({ ok: false, reason: 'path_not_found', message: 'No value at data.price' });
        const wrapper = mountView();

        await fillHttp({ wrapper });
        await wrapper.find('[data-testid="rate-source-test"]').trigger('click');
        await flushPromises();

        const failure = wrapper.find('[data-testid="rate-source-test-failure"]');
        expect(failure.text()).toContain('The JSON path points at nothing in the response.');
        expect(failure.text()).toContain('No value at data.price');
      });

      it('shows the refusal of the test request itself, such as the rate limit', async () => {
        mockTest.mockRejectedValue(
          new ApiErrorResponseError('slow down', {
            code: API_ERROR_CODES.tooManyRequests,
            message: 'Too many requests',
          }),
        );
        const wrapper = mountView();

        await fillHttp({ wrapper });
        await wrapper.find('[data-testid="rate-source-test"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[data-testid="rate-source-test-error"]').text()).toBe('Too many requests');
      });

      it('clears an old result as soon as a setting changes', async () => {
        mockTest.mockResolvedValue({ ok: true, date: '2026-10-17', rate: 1, quoteCurrency: 'USD' });
        const wrapper = mountView();

        await fillHttp({ wrapper });
        await wrapper.find('[data-testid="rate-source-test"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="rate-source-test-success"]').exists()).toBe(true);

        await setInput({ wrapper, testId: 'rate-source-http-path', value: 'data.other' });

        expect(wrapper.find('[data-testid="rate-source-test-success"]').exists()).toBe(false);
      });
    });
  });
});
