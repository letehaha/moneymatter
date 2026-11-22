import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { DOMWrapper, type VueWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
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
// The dropdown is portaled to the body, outside the wrapper.
const page = new DOMWrapper(document.body);
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

const findInput = ({ wrapper }: { wrapper: VueWrapper }) =>
  wrapper.find('input[data-testid="rate-source-coin-search"]');

const search = async ({ wrapper, term }: { wrapper: VueWrapper; term: string }) => {
  await findInput({ wrapper }).setValue(term);
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  await flushPromises();
};

const isDropdownOpen = ({ wrapper }: { wrapper: VueWrapper }) =>
  findInput({ wrapper }).attributes('aria-expanded') === 'true' && page.find('[role="listbox"]').exists();

// jsdom lacks scrollIntoView, which reka-ui calls on the highlighted option.
Element.prototype.scrollIntoView = vi.fn();
enableAutoUnmount(afterEach);

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

  it('keeps the dropdown closed until something is typed', () => {
    const wrapper = mountForm();

    expect(isDropdownOpen({ wrapper })).toBe(false);
  });

  it('opens the dropdown while typing and lists the matching coins once the typing pauses', async () => {
    mockSearch.mockResolvedValue([BITCOIN, WRAPPED]);
    const wrapper = mountForm();

    await findInput({ wrapper }).setValue('bit');
    expect(mockSearch).not.toHaveBeenCalled();
    expect(isDropdownOpen({ wrapper })).toBe(true);
    expect(page.find('[role="listbox"] [data-testid="rate-source-coin-loading"]').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flushPromises();

    expect(mockSearch).toHaveBeenCalledWith({ query: 'bit' });
    const options = page.findAll('[role="listbox"] [data-testid="rate-source-coin-results"] [role="option"]');
    expect(options.map((option) => option.attributes('data-testid'))).toEqual([
      'rate-source-coin-bitcoin',
      'rate-source-coin-wrapped-bitcoin',
    ]);
    expect(options[0]!.text()).toContain('Bitcoin');
    expect(options[0]!.text()).toContain('#1');
  });

  it('selects a coin, reports it with a readable label and closes the dropdown', async () => {
    mockSearch.mockResolvedValue([BITCOIN]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });
    await page.find('[data-testid="rate-source-coin-bitcoin"]').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { coinId: 'bitcoin', coinLabel: 'Bitcoin (BTC)', quoteCurrency: 'USD', logoUrl: 'https://img.test/btc.png' },
    ]);
    expect(wrapper.find('[data-testid="rate-source-selected-coin"]').text()).toBe('Selected coin: Bitcoin (BTC)');
    expect(isDropdownOpen({ wrapper })).toBe(false);
    expect((findInput({ wrapper }).element as HTMLInputElement).value).toBe('bit');
  });

  it('picks the highlighted coin with the arrow keys and Enter', async () => {
    mockSearch.mockResolvedValue([BITCOIN, WRAPPED]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });
    await findInput({ wrapper }).trigger('keydown', { key: 'ArrowDown' });
    await findInput({ wrapper }).trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ coinId: 'wrapped-bitcoin' });
    expect(isDropdownOpen({ wrapper })).toBe(false);
  });

  it('marks the selected coin in the results, also after it is picked again', async () => {
    mockSearch.mockResolvedValue([BITCOIN, WRAPPED]);
    const wrapper = mountForm({ coinId: 'bitcoin' });

    await search({ wrapper, term: 'bit' });

    expect(page.find('[data-testid="rate-source-coin-bitcoin"]').attributes('aria-selected')).toBe('true');
    expect(page.find('[data-testid="rate-source-coin-wrapped-bitcoin"]').attributes('aria-selected')).toBe('false');

    await page.find('[data-testid="rate-source-coin-bitcoin"]').trigger('click');
    await findInput({ wrapper }).trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();

    expect(isDropdownOpen({ wrapper })).toBe(true);
    expect(page.find('[data-testid="rate-source-coin-bitcoin"]').attributes('aria-selected')).toBe('true');
  });

  it('closes the dropdown on Escape', async () => {
    mockSearch.mockResolvedValue([BITCOIN]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });
    expect(isDropdownOpen({ wrapper })).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(isDropdownOpen({ wrapper })).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('carries no logo for a coin that has none', async () => {
    mockSearch.mockResolvedValue([WRAPPED]);
    const wrapper = mountForm();

    await search({ wrapper, term: 'wrapped' });
    await page.find('[data-testid="rate-source-coin-wrapped-bitcoin"]').trigger('click');

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

    expect(isDropdownOpen({ wrapper })).toBe(true);
    expect(page.find('[role="listbox"] [data-testid="rate-source-coin-empty"]').text()).toBe('No coins found');
  });

  it('reports that CoinGecko is not set up when the instance has no key', async () => {
    mockSearch.mockRejectedValue(
      new ApiErrorResponseError('not configured', {
        code: API_ERROR_CODES.cryptoProviderNotConfigured,
        message: 'Crypto search is unavailable',
      }),
    );
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });

    expect(wrapper.emitted('not-configured')).toHaveLength(1);
    expect(isDropdownOpen({ wrapper })).toBe(false);
    expect(page.find('[data-testid="rate-source-coin-empty"]').exists()).toBe(false);
    expect(page.find('[data-testid="rate-source-coin-search-error"]').exists()).toBe(false);
  });

  it('shows a retry hint for any other search failure', async () => {
    mockSearch.mockRejectedValue(new Error('network down'));
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });

    expect(isDropdownOpen({ wrapper })).toBe(true);
    expect(page.find('[role="listbox"] [data-testid="rate-source-coin-search-error"]').text()).toContain(
      'Could not search CoinGecko',
    );
    expect(wrapper.find('[data-testid="rate-source-coin-search-field-error"]').exists()).toBe(false);
    expect(wrapper.emitted('not-configured')).toBeUndefined();
  });

  it("keeps the API's explanation of a failed search under the field once the dropdown closes", async () => {
    mockSearch.mockRejectedValue(
      new ApiErrorResponseError('limited', { code: API_ERROR_CODES.unexpected, message: 'CoinGecko is rate limited' }),
    );
    const wrapper = mountForm();

    await search({ wrapper, term: 'bit' });
    expect(page.find('[role="listbox"] [data-testid="rate-source-coin-search-error"]').text()).toContain(
      'CoinGecko is rate limited',
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(isDropdownOpen({ wrapper })).toBe(false);
    expect(wrapper.get('[data-testid="rate-source-coin-search-field-error"]').text()).toBe('CoinGecko is rate limited');
  });
});
