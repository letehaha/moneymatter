import type { LogoSelection } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import formsEn from '@/i18n/locales/chunks/en/forms.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import CustomCurrencyDialog from './custom-currency-dialog.vue';
import type { EditableCustomCurrency } from './types';

const { mockCreate, mockUpdate, mockLoadCurrencies, mockAddSuccess, mockAddWarning, state } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockLoadCurrencies: vi.fn(),
  mockAddSuccess: vi.fn(),
  mockAddWarning: vi.fn(),
  state: {
    userCurrencies: [] as Array<{ currencyCode: string }>,
  },
}));

vi.mock('@/api/currencies', () => ({
  createCustomCurrency: mockCreate,
  updateCustomCurrency: mockUpdate,
  getBaseCurrencyChangeStatus: vi.fn(),
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockAddSuccess,
    addWarningNotification: mockAddWarning,
    addErrorNotification: vi.fn(),
  }),
}));

vi.mock('@/lib/sentry', () => ({ captureException: vi.fn() }));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('@/stores', async () => {
  const { computed, ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currencies: computed(() => state.userCurrencies),
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
  values: { code?: string; name?: string; symbol?: string; decimals?: string; rate?: string },
) => {
  if (values.code !== undefined) await field(wrapper, 'custom-currency-code').setValue(values.code);
  if (values.name !== undefined) await field(wrapper, 'custom-currency-name').setValue(values.name);
  if (values.symbol !== undefined) await field(wrapper, 'custom-currency-symbol').setValue(values.symbol);
  if (values.decimals !== undefined) await field(wrapper, 'custom-currency-decimals').setValue(values.decimals);
  if (values.rate !== undefined) await field(wrapper, 'custom-currency-rate').setValue(values.rate);
};

const submit = async (wrapper: VueWrapper) => {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

const TETHER: EditableCustomCurrency = {
  code: 'USDT',
  name: 'Tether',
  symbol: '₮',
  decimals: 6,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
};

const pickLogo = async (wrapper: VueWrapper, selection: LogoSelection | null) => {
  wrapper.getComponent(LogoSquareField).vm.$emit('update:modelValue', selection);
  await flushPromises();
};

describe('CustomCurrencyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userCurrencies = [{ currencyCode: 'USD' }];
    mockCreate.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});
    mockLoadCurrencies.mockResolvedValue(undefined);
  });

  describe('creating', () => {
    it('uppercases the code, sends the definition with its rate in the base currency and refreshes', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'usdt', name: ' Tether ', symbol: '₮', decimals: '6', rate: '1.0002' });
      await submit(wrapper);

      expect(mockCreate).toHaveBeenCalledWith({
        code: 'USDT',
        name: 'Tether',
        symbol: '₮',
        decimals: 6,
        rate: { value: 1.0002 },
      });
      expect(mockLoadCurrencies).toHaveBeenCalledWith({ force: true });
      expect(mockAddSuccess).toHaveBeenCalledWith('Custom currency added');
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    });

    it('sends no symbol when the field is left empty, and accepts 0 decimals', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'SAT', name: 'Satoshi', decimals: '0', rate: '0.0006' });
      await submit(wrapper);

      expect(mockCreate).toHaveBeenCalledWith({
        code: 'SAT',
        name: 'Satoshi',
        symbol: null,
        decimals: 0,
        rate: { value: 0.0006 },
      });
    });

    it('previews the symbol monogram the currency is drawn with until a logo is picked', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'usdt', name: 'Tether', symbol: '₮' });

      expect(wrapper.get('[data-testid="custom-currency-logo-placeholder"]').text()).toBe('₮');
    });

    it('sends the logo the user picked', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'SAT', name: 'Satoshi', decimals: '8', rate: '1' });
      await pickLogo(wrapper, { kind: 'monogram', initials: 'S', color: '#f7931a' });
      await submit(wrapper);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SAT', logoInitials: 'S', logoColor: '#f7931a' }),
      );
    });

    it.each<[string, string]>([
      ['an empty rate', ''],
      ['a zero rate', '0'],
      ['a negative rate', '-1'],
    ])('refuses %s without calling the API', async (_label, rate) => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6', rate });
      await submit(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Enter a rate above 0');
    });

    it('reports success and closes even when the currency list fails to refresh', async () => {
      mockLoadCurrencies.mockRejectedValue(new Error('offline'));
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6', rate: '1' });
      await submit(wrapper);

      expect(mockAddSuccess).toHaveBeenCalledWith('Custom currency added');
      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
      expect(mockAddWarning).toHaveBeenCalled();
      expect(wrapper.find('[data-testid="custom-currency-error"]').exists()).toBe(false);
    });

    it('previews an amount with the chosen decimals and symbol', async () => {
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', symbol: '₮', decimals: '4' });

      expect(wrapper.find('[data-testid="custom-currency-preview"]').text()).toBe('Example: 1,234.5000 ₮');
    });

    it.each<[string, { code: string; name: string; decimals: string; rate: string }, string]>([
      ['an ISO code', { code: 'USD', name: 'Dollar', decimals: '2', rate: '1' }, 'This is an ISO currency code'],
      [
        'a malformed code',
        { code: 'U', name: 'Tether', decimals: '6', rate: '1' },
        'Use 2 to 16 capital letters or digits',
      ],
      ['a missing name', { code: 'USDT', name: ' ', decimals: '6', rate: '1' }, 'Enter a name'],
      [
        'decimals above 8',
        { code: 'USDT', name: 'Tether', decimals: '9', rate: '1' },
        'Enter a whole number from 0 to 8',
      ],
    ])('refuses %s without calling the API', async (_label, values, message) => {
      const wrapper = mountDialog();

      await fill(wrapper, values);
      await submit(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain(message);
    });

    it('refuses a code the user already holds', async () => {
      state.userCurrencies.push({ currencyCode: 'USDT' });
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6', rate: '1' });
      await submit(wrapper);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('You already have a currency with this code');
    });

    it('shows the API explanation when the creation is refused', async () => {
      mockCreate.mockRejectedValue(
        new ApiErrorResponseError('taken', { code: API_ERROR_CODES.conflict, message: 'Code is taken' }),
      );
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6', rate: '1' });
      await submit(wrapper);

      expect(wrapper.find('[data-testid="custom-currency-error"]').text()).toBe('Code is taken');
      expect(mockLoadCurrencies).not.toHaveBeenCalled();
    });

    it('leaves a plan refusal to the API client toast', async () => {
      mockCreate.mockRejectedValue(
        new ApiErrorResponseError('plan', { code: API_ERROR_CODES.planRequired, message: 'Upgrade to Plus' }),
      );
      const wrapper = mountDialog();

      await fill(wrapper, { code: 'USDT', name: 'Tether', decimals: '6', rate: '1' });
      await submit(wrapper);

      expect(wrapper.find('[data-testid="custom-currency-error"]').exists()).toBe(false);
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

    it('opens on the stored logo and leaves it alone when untouched', async () => {
      const wrapper = mountDialog({ currency: { ...TETHER, logoDomain: 'tether.to' } });

      expect(wrapper.getComponent(LogoSquareField).props('modelValue')).toEqual({
        kind: 'brand',
        domain: 'tether.to',
      });

      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: '₮' });
    });

    it('removes a stored image with logoImage null', async () => {
      const wrapper = mountDialog({ currency: { ...TETHER, logoImageId: '00000000-0000-4000-8000-000000000001' } });

      await pickLogo(wrapper, null);
      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({
        code: 'USDT',
        name: 'Tether',
        symbol: '₮',
        logoDomain: null,
        logoInitials: null,
        logoIcon: null,
        logoImage: null,
      });
    });

    it('clears the symbol with null', async () => {
      const wrapper = mountDialog({ currency: TETHER });

      await fill(wrapper, { symbol: '' });
      await submit(wrapper);

      expect(mockUpdate).toHaveBeenCalledWith({ code: 'USDT', name: 'Tether', symbol: null });
    });

    it('sends the new decimals while no account holds the currency', async () => {
      const wrapper = mountDialog({ currency: TETHER, accountsCount: 0 });
      const warning = () => wrapper.find('[data-testid="custom-currency-decimals-warning"]');

      expect(warning().exists()).toBe(false);

      await fill(wrapper, { decimals: '8' });

      expect(warning().text()).toBe(i18n.global.t('settings.currencies.delete.foreignAmountsWarning'));

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
      const message = 'Cannot change the decimals of "USDT": it is still in use';
      mockUpdate.mockRejectedValue(
        new ApiErrorResponseError(message, {
          code: API_ERROR_CODES.currencyInUse,
          message,
          details: { blockers: [{ type: 'goal', id: '1', name: 'Trip' }] },
        }),
      );
      const wrapper = mountDialog({ currency: TETHER, accountsCount: 0 });

      await fill(wrapper, { decimals: '8' });
      await submit(wrapper);

      expect(wrapper.find('[data-testid="custom-currency-error"]').text()).toBe(message);
      expect(wrapper.find('[data-testid="currency-blocker-list"]').text()).toContain('Trip');
      expect(wrapper.emitted('update:open')).toBeUndefined();
    });
  });
});
