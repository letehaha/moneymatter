import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { type UserCurrencyModel } from '@bt/shared/types';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { addDays, format } from 'date-fns';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import ExchangeRateForm from './exchange-rate-form.vue';

const { mockEdit, mockDelete } = vi.hoisted(() => ({ mockEdit: vi.fn(), mockDelete: vi.fn() }));

vi.mock('@/api/currencies', () => ({
  editUserCurrenciesExchangeRates: mockEdit,
  deleteCustomRate: mockDelete,
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: vi.fn(),
    addWarningNotification: vi.fn(),
    addErrorNotification: vi.fn(),
  }),
}));

// The calendar popover is not under test: a native date input stands in and emits a Date.
vi.mock('@/components/fields/date-field.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'DateFieldStub',
      inheritAttrs: false,
      props: ['modelValue'],
      emits: ['update:modelValue'],
      setup(props, { emit, attrs }) {
        return () =>
          h('input', {
            type: 'date',
            'data-testid': attrs['data-testid'],
            value: format(props.modelValue, 'yyyy-MM-dd'),
            onInput: (event: Event) => {
              const [year, month, day] = (event.target as HTMLInputElement).value.split('-').map(Number);
              emit('update:modelValue', new Date(year!, month! - 1, day));
            },
          });
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
                slots.default?.(),
                h('button', { 'data-testid': 'confirm', onClick: () => emit('confirm') }),
              ])
            : null;
      },
    }),
  };
});

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { ...currenciesEn } } });

const buildCurrency = ({ isCustom, rate = 0 }: { isCustom: boolean; rate?: number }): CurrencyWithExchangeRate =>
  ({
    id: 1,
    currencyCode: isCustom ? 'BTC' : 'EUR',
    liveRateUpdate: !isCustom,
    currency: { code: isCustom ? 'BTC' : 'EUR', isCustom },
    rate,
    quoteRate: rate ? 1 / rate : Number.NaN,
    quoteCode: 'USD',
    custom: false,
  }) as unknown as CurrencyWithExchangeRate & UserCurrencyModel;

const mountForm = ({ currency }: { currency: CurrencyWithExchangeRate }) =>
  mount(ExchangeRateForm, {
    props: { currency, isFormDisabled: false },
    global: { plugins: [i18n] },
  });

const inputs = (wrapper: VueWrapper) => wrapper.findAll('input:not([type="date"]):not([type="checkbox"])');

describe('ExchangeRateForm for a custom currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEdit.mockResolvedValue({ rates: [], remeasure: { failed: 0 } });
    mockDelete.mockResolvedValue({ remeasure: { failed: 0 } });
  });

  it('saves the rate for today when the date is left alone', async () => {
    const wrapper = mountForm({ currency: buildCurrency({ isCustom: true }) });
    const today = format(new Date(), 'yyyy-MM-dd');

    await inputs(wrapper)[0]!.trigger('focus');
    await inputs(wrapper)[0]!.setValue('50000');
    await wrapper.find('button.min-w-24').trigger('click');
    await flushPromises();

    expect(mockEdit).toHaveBeenCalledWith([
      { baseCode: 'BTC', quoteCode: 'USD', rate: 50000, effectiveDate: today },
      { baseCode: 'USD', quoteCode: 'BTC', rate: 0.00002, effectiveDate: today },
    ]);
  });

  it('saves the rate from the chosen date, and the date alone enables Save once a rate is there', async () => {
    const wrapper = mountForm({ currency: buildCurrency({ isCustom: true, rate: 50000 }) });
    const earlier = format(addDays(new Date(), -30), 'yyyy-MM-dd');

    expect(wrapper.find('button.min-w-24').attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="manual-rate-effective-date"]').setValue(earlier);
    expect(wrapper.find('button.min-w-24').attributes('disabled')).toBeUndefined();

    await wrapper.find('button.min-w-24').trigger('click');
    await flushPromises();

    expect(mockEdit.mock.calls[0]![0].map((pair: { effectiveDate: string }) => pair.effectiveDate)).toEqual([
      earlier,
      earlier,
    ]);
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('removes the rate that starts on a chosen day, in both directions', async () => {
    const wrapper = mountForm({ currency: buildCurrency({ isCustom: true, rate: 50000 }) });
    const day = format(addDays(new Date(), -10), 'yyyy-MM-dd');

    await wrapper.find('[data-testid="manual-rate-remove"]').trigger('click');
    await wrapper.find('[data-testid="manual-rate-remove-date"]').setValue(day);
    await wrapper.find('[data-testid="confirm"]').trigger('click');
    await flushPromises();

    expect(mockDelete).toHaveBeenCalledWith([
      { baseCode: 'BTC', quoteCode: 'USD', effectiveDate: day },
      { baseCode: 'USD', quoteCode: 'BTC', effectiveDate: day },
    ]);
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });
});

describe('ExchangeRateForm for an ISO currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEdit.mockResolvedValue({ rates: [], remeasure: { failed: 0 } });
  });

  it('has no date field or rate removal, and sends no effective date', async () => {
    const wrapper = mountForm({ currency: buildCurrency({ isCustom: false, rate: 0.9 }) });

    expect(wrapper.find('[data-testid="manual-rate-effective-date"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="manual-rate-remove"]').exists()).toBe(false);

    await wrapper.find('input[type="checkbox"], button[role="checkbox"]').trigger('click');
    await inputs(wrapper)[0]!.trigger('focus');
    await inputs(wrapper)[0]!.setValue('0.8');
    await wrapper.find('button.min-w-24').trigger('click');
    await flushPromises();

    expect(mockEdit).toHaveBeenCalledWith([
      { baseCode: 'EUR', quoteCode: 'USD', rate: 0.8 },
      { baseCode: 'USD', quoteCode: 'EUR', rate: 1.25 },
    ]);
  });
});
