import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import CoingeckoSourceForm from './coingecko-source-form.vue';
import type { RateSourceDraft } from './rate-source-draft';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('@/api/currencies', () => ({ searchCoingeckoCoins: mockSearch }));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currencies: ref([]),
      isoCurrencies: ref([{ code: 'USD', currency: 'US Dollar' }]),
    }),
  };
});

vi.mock('@/components/fields/select-field.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return { default: defineComponent({ name: 'SelectFieldStub', setup: () => () => h('div') }) };
});

const SEARCH_DEBOUNCE_MS = 300;
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { ...currenciesEn } } });

const BITCOIN = {
  coinId: 'bitcoin',
  symbol: 'btc',
  name: 'Bitcoin',
  logoUrl: 'https://img.test/btc.png',
  marketCapRank: 1,
};
const WRAPPED = {
  coinId: 'wrapped-bitcoin',
  symbol: 'wbtc',
  name: 'Wrapped Bitcoin',
  logoUrl: null,
  marketCapRank: null,
};

const mountForm = ({ coinId = '' }: { coinId?: string } = {}) => {
  const model: RateSourceDraft['coingecko'] = { coinId, coinLabel: coinId, quoteCurrency: 'USD', logoUrl: null };
  const wrapper = mount(CoingeckoSourceForm, {
    props: {
      modelValue: model,
      errors: {},
      'onUpdate:modelValue': (value: RateSourceDraft['coingecko']) => wrapper.setProps({ modelValue: value }),
    },
    global: {
      plugins: [
        i18n,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
  });

  return wrapper;
};

const search = async ({ wrapper, term }: { wrapper: VueWrapper; term: string }) => {
  await wrapper
    .find('[data-testid="rate-source-coin-search"] input, input[data-testid="rate-source-coin-search"]')
    .setValue(term);
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  await flushPromises();
};

describe('CoingeckoSourceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not search before anything is typed', async () => {
    mountForm();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('waits for the typing to pause and then lists the matching coins', async () => {
    mockSearch.mockResolvedValue([BITCOIN, WRAPPED]);
    const wrapper = mountForm();

    await wrapper
      .find('input[data-testid="rate-source-coin-search"], [data-testid="rate-source-coin-search"] input')
      .setValue('bit');
    expect(mockSearch).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="rate-source-coin-loading"]').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flushPromises();

    expect(mockSearch).toHaveBeenCalledWith({ query: 'bit' });
    const results = wrapper.find('[data-testid="rate-source-coin-results"]');
    expect(results.text()).toContain('Bitcoin');
    expect(results.text()).toContain('#1');
    expect(results.text()).toContain('Wrapped Bitcoin');
  });

  it('selects a coin and reports it with a readable label', async () => {
    mockSearch.mockResolvedValue([BITCOIN]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });
    await wrapper.find('[data-testid="rate-source-coin-bitcoin"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { coinId: 'bitcoin', coinLabel: 'Bitcoin (BTC)', quoteCurrency: 'USD', logoUrl: 'https://img.test/btc.png' },
    ]);
    expect(wrapper.find('[data-testid="rate-source-selected-coin"]').text()).toBe('Selected coin: Bitcoin (BTC)');
  });

  it('carries no logo for a coin that has none', async () => {
    mockSearch.mockResolvedValue([WRAPPED]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'wrapped' });
    await wrapper.find('[data-testid="rate-source-coin-wrapped-bitcoin"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { coinId: 'wrapped-bitcoin', coinLabel: 'Wrapped Bitcoin (WBTC)', quoteCurrency: 'USD', logoUrl: null },
    ]);
  });

  it('shows the saved coin before any search', () => {
    const wrapper = mountForm({ coinId: 'bitcoin' });

    expect(wrapper.find('[data-testid="rate-source-selected-coin"]').text()).toBe('Selected coin: bitcoin');
  });

  it('says so when no coin matches', async () => {
    mockSearch.mockResolvedValue([]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'zzzz' });

    expect(wrapper.find('[data-testid="rate-source-coin-empty"]').text()).toBe('No coins found');
  });

  it('tells the user CoinGecko is not set up when the instance has no key', async () => {
    mockSearch.mockRejectedValue(
      new ApiErrorResponseError('not configured', {
        code: API_ERROR_CODES.cryptoProviderNotConfigured,
        message: 'Crypto search is unavailable',
      }),
    );
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });

    expect(wrapper.find('[data-testid="rate-source-coingecko-not-configured"]').text()).toContain('COINGECKO_API_KEY');
    expect(wrapper.find('[data-testid="rate-source-coin-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="rate-source-coin-search-error"]').exists()).toBe(false);
  });

  it('shows a retry hint for any other search failure', async () => {
    mockSearch.mockRejectedValue(
      new ApiErrorResponseError('boom', { code: API_ERROR_CODES.unexpected, message: 'boom' }),
    );
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });

    expect(wrapper.find('[data-testid="rate-source-coin-search-error"]').text()).toContain(
      'Could not search CoinGecko',
    );
    expect(wrapper.find('[data-testid="rate-source-coingecko-not-configured"]').exists()).toBe(false);
  });
});
