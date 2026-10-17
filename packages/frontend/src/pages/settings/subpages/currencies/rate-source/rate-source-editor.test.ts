import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type UpdateCurrencyRateSourceBody, type UserCurrencyModel } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import RateSourceEditor from './rate-source-editor.vue';

const { mockUpdate, mockTest, mockSearch, mockAddSuccess } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockTest: vi.fn(),
  mockSearch: vi.fn(),
  mockAddSuccess: vi.fn(),
}));

vi.mock('@/api/currencies', () => ({
  updateCurrencyRateSource: mockUpdate,
  testCurrencyRateSource: mockTest,
  searchCoingeckoCoins: mockSearch,
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: mockAddSuccess, addErrorNotification: vi.fn() }),
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
        { currencyCode: 'USD', currency: { currency: 'US Dollar' } },
        { currencyCode: 'USDT', currency: { currency: 'Tether' } },
        { currencyCode: 'USDC', currency: { currency: 'USD Coin' } },
      ]),
      isoCurrencies: ref([
        { code: 'USD', currency: 'US Dollar' },
        { code: 'EUR', currency: 'Euro' },
      ]),
    }),
  };
});

// The rate form has its own tests; here it only marks that the manual source rendered it.
vi.mock('../currency-row/exchange-rate-form.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ExchangeRateFormStub',
      setup: () => () => h('div', { 'data-testid': 'manual-form' }),
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
      props: ['modelValue', 'values', 'label', 'errorMessage'],
      emits: ['update:modelValue'],
      setup(props, { emit, attrs }) {
        return () =>
          h('div', {}, [
            h(
              'select',
              {
                'data-testid': attrs['data-testid'],
                value: props.modelValue?.value ?? '',
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

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { ...currenciesEn } } });

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
    rate: 0,
    quoteCode: 'USD',
    quoteRate: 0,
    ...patch,
  }) as unknown as CurrencyWithExchangeRate;

const mountEditor = ({ currency = buildCurrency() }: { currency?: CurrencyWithExchangeRate } = {}) =>
  mount(RateSourceEditor, {
    props: { currency, isFormDisabled: false },
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

const selectTab = async (wrapper: VueWrapper, source: string) => {
  await wrapper.find(`[data-testid="rate-source-tabs"] [data-value="${source}"]`).trigger('click');
};

const setInput = async (wrapper: VueWrapper, testId: string, value: string) => {
  await wrapper.find(`input[data-testid="${testId}"], [data-testid="${testId}"] input`).setValue(value);
};

const save = async (wrapper: VueWrapper) => {
  await wrapper.find('[data-testid="rate-source-save"]').trigger('click');
  await flushPromises();
};

describe('RateSourceEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('manual source', () => {
    it('shows the dated rate form and no Save button while the saved source is manual', () => {
      const wrapper = mountEditor();

      expect(wrapper.find('[data-testid="manual-form"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="rate-source-save"]').exists()).toBe(false);
    });

    it('reads a currency with no source set as manual', () => {
      const wrapper = mountEditor({ currency: buildCurrency({ rateSource: 'provider' }) });

      expect(wrapper.find('[data-testid="manual-form"]').exists()).toBe(true);
    });

    it('asks to save the source before rates can be entered when another source is saved', async () => {
      const wrapper = mountEditor({
        currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1 } }),
      });

      await selectTab(wrapper, 'manual');

      expect(wrapper.find('[data-testid="manual-form"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-source-manual-unsaved"]').exists()).toBe(true);

      await save(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'BTC', body: { rateSource: 'manual' } });
    });
  });

  describe('peg source', () => {
    it('saves the peg currency and factor, lists the other held currencies and refreshes after saving', async () => {
      const wrapper = mountEditor();

      await selectTab(wrapper, 'peg');
      const options = wrapper.findAll('[data-testid="rate-source-peg-currency"] option').map((item) => item.text());
      expect(options).toContain('USDT · Tether');
      expect(options).not.toContain('BTC');

      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('USD');
      await setInput(wrapper, 'rate-source-peg-factor', '0.5');
      await save(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({
        code: 'BTC',
        body: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 0.5 } },
      });
      expect(mockAddSuccess).toHaveBeenCalledWith('Rate source saved');
      expect(wrapper.emitted('changed')).toHaveLength(1);
    });

    it('refuses a missing peg currency and a factor that is not positive, without calling the API', async () => {
      const wrapper = mountEditor();

      await selectTab(wrapper, 'peg');
      await setInput(wrapper, 'rate-source-peg-factor', '0');
      await save(wrapper);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Select the currency to peg to');
      expect(wrapper.text()).toContain('Enter a number above 0');
      expect(wrapper.emitted('changed')).toBeUndefined();
    });

    it('seeds the form from the saved peg and hides Save until something changes', async () => {
      const wrapper = mountEditor({
        currency: buildCurrency({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 2 } }),
      });

      expect(
        (
          wrapper.find('input[data-testid="rate-source-peg-factor"], [data-testid="rate-source-peg-factor"] input')
            .element as HTMLInputElement
        ).value,
      ).toBe('2');
      expect(wrapper.find('[data-testid="rate-source-save"]').exists()).toBe(false);

      await setInput(wrapper, 'rate-source-peg-factor', '3');

      expect(wrapper.find('[data-testid="rate-source-save"]').exists()).toBe(true);
    });
  });

  describe('save failures', () => {
    it('says CoinGecko is unavailable when the instance has no CoinGecko key', async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('not configured', {
          code: API_ERROR_CODES.cryptoProviderNotConfigured,
          message: 'Crypto provider is not configured',
        }),
      );
      const wrapper = mountEditor({
        currency: buildCurrency({
          rateSource: 'coingecko',
          rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
        }),
      });

      await wrapper.find('[data-testid="rate-source-coingecko-quote"]').setValue('EUR');
      await save(wrapper);

      expect(wrapper.find('[data-testid="rate-source-not-configured"]').text()).toContain('COINGECKO_API_KEY');
      expect(wrapper.emitted('changed')).toBeUndefined();
    });

    it("shows the API's explanation of a refusal", async () => {
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Peg cycle detected' }),
      );
      const wrapper = mountEditor();

      await selectTab(wrapper, 'peg');
      await wrapper.find('[data-testid="rate-source-peg-currency"]').setValue('USDT');
      await save(wrapper);

      expect(wrapper.find('[data-testid="rate-source-error"]').text()).toBe('Peg cycle detected');
    });
  });

  describe('http source', () => {
    const URL_TEMPLATE = 'https://api.example.com/price?id={code}';

    const fillHttp = async (wrapper: VueWrapper) => {
      await selectTab(wrapper, 'http');
      await setInput(wrapper, 'rate-source-http-url', URL_TEMPLATE);
      await setInput(wrapper, 'rate-source-http-path', 'data.price');
    };

    it('saves the URL, path and quote currency, and typed headers as the new set', async () => {
      const wrapper = mountEditor();

      await fillHttp(wrapper);
      await wrapper.find('[data-testid="rate-source-add-header"]').trigger('click');
      await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-Api-Key');
      await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('secret');
      await save(wrapper);

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

    it('masks header values while they are typed', async () => {
      const wrapper = mountEditor();

      await selectTab(wrapper, 'http');
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
        const wrapper = mountEditor({ currency: savedHttp() });

        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').text()).toContain('X-Api-Key, Accept');
        expect(wrapper.find('[data-testid="rate-source-header-row-0"]').exists()).toBe(false);

        await setInput(wrapper, 'rate-source-http-path', 'data.rate');
        await save(wrapper);

        const body = mockUpdate.mock.calls[0]![0].body;
        expect(body.config.jsonPath).toBe('data.rate');
        expect('headers' in body.config).toBe(false);
      });

      it('clears the saved headers with an empty object', async () => {
        const wrapper = mountEditor({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-clear-headers"]').trigger('click');
        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').text()).toContain('will be removed');
        await save(wrapper);

        expect(mockUpdate.mock.calls[0]![0].body.config.headers).toEqual({});
      });

      it('replaces them with the typed rows', async () => {
        const wrapper = mountEditor({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('Authorization');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('Bearer x');
        await save(wrapper);

        expect(mockUpdate.mock.calls[0]![0].body.config.headers).toEqual({ Authorization: 'Bearer x' });
      });

      it('can back out of replacing them to keep the saved ones', async () => {
        const wrapper = mountEditor({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-cancel-replace-headers"]').trigger('click');

        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="rate-source-save"]').exists()).toBe(false);
      });

      it('shows the names the API returned and drops the typed values after a save', async () => {
        const wrapper = mountEditor({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-New');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('top-secret');
        await save(wrapper);

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
        const wrapper = mountEditor({ currency: savedHttp() });

        await wrapper.find('[data-testid="rate-source-replace-headers"]').trigger('click');
        await wrapper.find('[data-testid="rate-source-header-row-0"] input').setValue('X-Api-Key');
        await wrapper.findAll('[data-testid="rate-source-header-row-0"] input')[1]!.setValue('rotated-secret');
        mockUpdate.mockResolvedValueOnce({
          currencyCode: 'BTC',
          rateSource: 'http',
          rateSourceConfig: savedHttp().rateSourceConfig,
        });
        await save(wrapper);

        // The saved source is the one it was before, so the editor must not keep the typed secret.
        expect(wrapper.find('[data-testid="rate-source-save"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="rate-source-header-row-0"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="rate-source-saved-headers"]').text()).toContain('X-Api-Key');
        expect(wrapper.html()).not.toContain('rotated-secret');
      });
    });

    describe('Test button', () => {
      it('is disabled until the URL and path are filled', async () => {
        const wrapper = mountEditor();

        await selectTab(wrapper, 'http');
        expect(wrapper.find('[data-testid="rate-source-test"]').attributes('disabled')).toBeDefined();

        await setInput(wrapper, 'rate-source-http-url', URL_TEMPLATE);
        await setInput(wrapper, 'rate-source-http-path', 'data.price');
        expect(wrapper.find('[data-testid="rate-source-test"]').attributes('disabled')).toBeUndefined();
      });

      it('previews the rate without saving', async () => {
        mockTest.mockResolvedValue({ ok: true, date: '2026-10-17', rate: 67123.45, quoteCurrency: 'USD' });
        const wrapper = mountEditor();

        await selectTab(wrapper, 'http');
        await setInput(wrapper, 'rate-source-http-url', URL_TEMPLATE);
        await setInput(wrapper, 'rate-source-http-path', 'data.price');
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
        const wrapper = mountEditor();

        await selectTab(wrapper, 'http');
        await setInput(wrapper, 'rate-source-http-url', URL_TEMPLATE);
        await setInput(wrapper, 'rate-source-http-path', 'data.price');
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
        const wrapper = mountEditor();

        await selectTab(wrapper, 'http');
        await setInput(wrapper, 'rate-source-http-url', URL_TEMPLATE);
        await setInput(wrapper, 'rate-source-http-path', 'data.price');
        await wrapper.find('[data-testid="rate-source-test"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[data-testid="rate-source-test-error"]').text()).toBe('Too many requests');
      });

      it('clears an old result as soon as a setting changes', async () => {
        mockTest.mockResolvedValue({ ok: true, date: '2026-10-17', rate: 1, quoteCurrency: 'USD' });
        const wrapper = mountEditor();

        await selectTab(wrapper, 'http');
        await setInput(wrapper, 'rate-source-http-url', URL_TEMPLATE);
        await setInput(wrapper, 'rate-source-http-path', 'data.price');
        await wrapper.find('[data-testid="rate-source-test"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="rate-source-test-success"]').exists()).toBe(true);

        await setInput(wrapper, 'rate-source-http-path', 'data.other');

        expect(wrapper.find('[data-testid="rate-source-test-success"]').exists()).toBe(false);
      });
    });
  });
});
