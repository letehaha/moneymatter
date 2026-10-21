import formsEn from '@/i18n/locales/chunks/en/forms.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import CustomCurrencyDialog from './custom-currency-dialog.vue';
import type { EditableCustomCurrency } from './types';

const { mockCreate, mockUpdate, mockSearch, mockLoadCurrencies, mockAddSuccess, state } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSearch: vi.fn(),
  mockLoadCurrencies: vi.fn(),
  mockAddSuccess: vi.fn(),
  state: { userCurrencyCodes: [] as string[] },
}));

vi.mock('@/api/currencies', () => ({
  createCustomCurrency: mockCreate,
  updateCustomCurrency: mockUpdate,
  searchCoingeckoCoins: mockSearch,
}));

// The icon reads the user's currency list; here it only reports which logo the dialog hands it.
vi.mock('@/components/common/currency-icon.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'CurrencyIconStub',
      props: ['code', 'size', 'logoUrl'],
      setup: (props) => () =>
        h('span', { 'data-testid': 'currency-icon-stub', 'data-code': props.code, 'data-logo': props.logoUrl ?? '' }),
    }),
  };
});

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: mockAddSuccess, addErrorNotification: vi.fn() }),
}));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('@/stores', async () => {
  const { computed, ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currencies: computed(() => state.userCurrencyCodes.map((currencyCode) => ({ currencyCode }))),
      isoCurrencies: ref([{ code: 'USD' }, { code: 'EUR' }]),
      loadCurrencies: mockLoadCurrencies,
    }),
  };
});

vi.mock('@/components/common/responsive-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveDialogStub',
      props: { open: { type: Boolean, default: true } },
      emits: ['update:open'],
      setup(props, { emit, slots }) {
        const close = () => emit('update:open', false);
        return () =>
          props.open === false
            ? null
            : h('div', {}, [
                slots.title?.(),
                slots.description?.(),
                slots.default?.({ close }),
                slots.footer?.({ close }),
              ]);
      },
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { ...currenciesEn, ...formsEn } },
});

const mountDialog = ({ currency, accountsCount }: { currency?: EditableCustomCurrency; accountsCount?: number } = {}) =>
  mount(CustomCurrencyDialog, {
    props: { open: true, currency, accountsCount },
    global: {
      plugins: [
        i18n,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { mutations: { retry: false } } }) }],
      ],
    },
  });

const field = (wrapper: VueWrapper, testId: string) =>
  wrapper.find(`[data-testid="${testId}"] input, input[data-testid="${testId}"]`);

const fill = async (
  wrapper: VueWrapper,
  values: { code?: string; name?: string; symbol?: string; decimals?: string },
) => {
  if (values.code !== undefined) await field(wrapper, 'custom-currency-code').setValue(values.code);
  if (values.name !== undefined) await field(wrapper, 'custom-currency-name').setValue(values.name);
  if (values.symbol !== undefined) await field(wrapper, 'custom-currency-symbol').setValue(values.symbol);
  if (values.decimals !== undefined) await field(wrapper, 'custom-currency-decimals').setValue(values.decimals);
};

const submit = async (wrapper: VueWrapper) => {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

const TETHER: EditableCustomCurrency = { code: 'USDT', name: 'Tether', symbol: '₮', decimals: 6 };
const TETHER_LOGO = 'https://img.test/usdt.png';
const SEARCH_DEBOUNCE_MS = 300;

const COIN = {
  coinId: 'tether',
  symbol: 'usdt',
  name: 'Tether',
  logoUrl: 'https://img.test/tether.png',
  marketCapRank: 3,
};
const COIN_WITHOUT_LOGO = {
  coinId: 'tether-gold',
  symbol: 'xaut',
  name: 'Tether Gold',
  logoUrl: null,
  marketCapRank: 40,
};

const iconLogo = (wrapper: VueWrapper) => wrapper.get('[data-testid="currency-icon-stub"]').attributes('data-logo');

const searchCoins = async (wrapper: VueWrapper, term: string) => {
  await field(wrapper, 'rate-source-coin-search').setValue(term);
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  await flushPromises();
};

describe('CustomCurrencyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userCurrencyCodes = [];
    mockCreate.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});
  });

  describe('creating', () => {
    it('uppercases the code, sends the definition and refreshes the currency list', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'usdt', name: ' Tether ', symbol: '₮', decimals: '6' });
      await submit(wrapper);

      expect(mockCreate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: '₮', decimals: 6 });
      expect(mockLoadCurrencies).toHaveBeenCalledWith({ force: true });
      expect(mockAddSuccess).toHaveBeenCalledWith('Custom currency added');
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    });

    it('sends no symbol when the field is left empty, and accepts 0 decimals', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'SAT', name: 'Satoshi', decimals: '0' });
      await submit(wrapper);

      expect(mockCreate).toHaveBeenCalledWith({ code: 'SAT', name: 'Satoshi', symbol: null, decimals: 0 });
    });

    it('previews an amount with the chosen decimals and symbol', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', symbol: '₮', decimals: '4' });

      expect(wrapper.find('[data-testid="custom-currency-preview"]').text()).toBe('Example: 1,234.5000 ₮');
    });

    it.each<[string, { code: string; name: string; decimals: string }, string]>([
      ['an ISO code', { code: 'USD', name: 'Dollar', decimals: '2' }, 'This is an ISO currency code'],
      ['a malformed code', { code: 'U', name: 'Tether', decimals: '6' }, 'Use 2 to 16 capital letters or digits'],
      ['a missing name', { code: 'USDT', name: ' ', decimals: '6' }, 'Enter a name'],
      ['decimals above 18', { code: 'USDT', name: 'Tether', decimals: '19' }, 'Enter a whole number from 0 to 18'],
    ])('refuses %s without calling the API', async (_label, values, message) => {
      const wrapper = mountDialog();

      await fill(wrapper, values);
      await submit(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain(message);
    });

    it('refuses a code the user already holds', async () => {
      state.userCurrencyCodes = ['USDT'];
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6' });
      await submit(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('You already have a currency with this code');
    });

    it('shows the API explanation when the creation is refused', async () => {
      mockCreate.mockRejectedValue(
        new ApiErrorResponseError('taken', { code: API_ERROR_CODES.conflict, message: 'Code is taken' }),
      );
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6' });
      await submit(wrapper);

      expect(wrapper.find('[data-testid="custom-currency-error"]').text()).toBe('Code is taken');
      expect(mockLoadCurrencies).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    it('fixes the code and sends only what changed', async () => {
      const wrapper = mountDialog({ currency: TETHER });

      expect(field(wrapper, 'custom-currency-code').attributes('disabled')).toBeDefined();

      await fill(wrapper, { name: 'Tether USD' });
      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether USD', symbol: '₮' });
      expect(mockAddSuccess).toHaveBeenCalledWith('Custom currency updated');
    });

    it('clears the symbol with null', async () => {
      const wrapper = mountDialog({ currency: TETHER });

      await fill(wrapper, { symbol: '' });
      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: null });
    });

    it('sends the new decimals while no account holds the currency', async () => {
      const wrapper = mountDialog({ currency: TETHER, accountsCount: 0 });

      await fill(wrapper, { decimals: '8' });
      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: '₮', decimals: 8 });
    });

    it('locks the decimals and says why while an account holds the currency', () => {
      const wrapper = mountDialog({ currency: TETHER, accountsCount: 2 });

      expect(field(wrapper, 'custom-currency-decimals').attributes('disabled')).toBeDefined();
      expect(wrapper.find('[data-testid="custom-currency-decimals-hint"]').text()).toContain(
        'Decimals can change only while no account, transaction or template uses USDT',
      );
    });

    it('surfaces the API refusal of a decimals change on a currency a transaction still uses', async () => {
      const message = 'Cannot change the decimals of "USDT": your transactions still use it';
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError(message, {
          code: API_ERROR_CODES.conflict,
          message,
          details: { usedBy: ['transactions'] },
        }),
      );
      const wrapper = mountDialog({ currency: TETHER, accountsCount: 0 });

      await fill(wrapper, { decimals: '8' });
      await submit(wrapper);

      expect(wrapper.find('[data-testid="custom-currency-error"]').text()).toBe(message);
      expect(wrapper.emitted('update:open')).toBeUndefined();
    });
  });
  describe('logo', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSearch.mockResolvedValue([COIN, COIN_WITHOUT_LOGO]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('has no logo field while creating, since the icon needs a saved currency', () => {
      const wrapper = mountDialog();

      expect(wrapper.find('[data-testid="custom-currency-logo"]').exists()).toBe(false);
    });

    it('previews the saved logo and sends none when the field is untouched', async () => {
      const wrapper = mountDialog({ currency: { ...TETHER, logoUrl: TETHER_LOGO } });

      expect(wrapper.get('[data-testid="currency-icon-stub"]').attributes('data-code')).toBe('USDT');
      expect(iconLogo(wrapper)).toBe(TETHER_LOGO);

      await fill(wrapper, { name: 'Tether USD' });
      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether USD', symbol: '₮' });
    });

    it('searches CoinGecko, previews the picked coin and sends its logo on save', async () => {
      const wrapper = mountDialog({ currency: TETHER });
      expect(iconLogo(wrapper)).toBe('');

      await searchCoins(wrapper, 'teth');
      expect(mockSearch).toHaveBeenCalledWith({ query: 'teth' });
      await wrapper.find('[data-testid="rate-source-coin-tether"]').trigger('click');

      expect(iconLogo(wrapper)).toBe('https://img.test/tether.png');

      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({
        code: 'USDT',
        name: 'Tether',
        symbol: '₮',
        logoUrl: 'https://img.test/tether.png',
      });
    });

    it('leaves the logo as it is when the picked coin has no image', async () => {
      const wrapper = mountDialog({ currency: { ...TETHER, logoUrl: TETHER_LOGO } });

      await searchCoins(wrapper, 'teth');
      await wrapper.find('[data-testid="rate-source-coin-tether-gold"]').trigger('click');

      expect(iconLogo(wrapper)).toBe(TETHER_LOGO);

      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: '₮' });
    });

    it('clears the logo with null', async () => {
      const wrapper = mountDialog({ currency: { ...TETHER, logoUrl: TETHER_LOGO } });

      await wrapper.find('[data-testid="custom-currency-logo-clear"]').trigger('click');

      expect(iconLogo(wrapper)).toBe('');
      expect(wrapper.find('[data-testid="custom-currency-logo-clear"]').exists()).toBe(false);

      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: '₮', logoUrl: null });
    });

    it('offers no clear button while the currency has no logo', () => {
      const wrapper = mountDialog({ currency: TETHER });

      expect(wrapper.find('[data-testid="custom-currency-logo-clear"]').exists()).toBe(false);
    });

    it('does not submit the form when Enter is pressed in the search box', async () => {
      const wrapper = mountDialog({ currency: TETHER });

      await field(wrapper, 'rate-source-coin-search').trigger('keydown.enter');

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('forgets an unsaved pick when the dialog is opened again', async () => {
      const wrapper = mountDialog({ currency: TETHER });
      await searchCoins(wrapper, 'teth');
      await wrapper.find('[data-testid="rate-source-coin-tether"]').trigger('click');
      expect(iconLogo(wrapper)).toBe('https://img.test/tether.png');

      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });

      expect(iconLogo(wrapper)).toBe('');
      await submit(wrapper);
      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: '₮' });
    });
  });
});
