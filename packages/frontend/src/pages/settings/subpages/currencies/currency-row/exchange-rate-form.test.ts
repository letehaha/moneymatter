import { deleteCustomRate, editUserCurrenciesExchangeRates } from '@/api/currencies';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { addDays, format } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import ExchangeRateForm from './exchange-rate-form.vue';

vi.mock('@/api/currencies', () => ({
  deleteCustomRate: vi.fn(),
  editUserCurrenciesExchangeRates: vi.fn(),
}));

const { mockAddError } = vi.hoisted(() => ({ mockAddError: vi.fn() }));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: vi.fn(),
    addWarningNotification: vi.fn(),
    addErrorNotification: mockAddError,
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

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } });

const ISO_PAIR = {
  currency: { code: 'USD' },
  quoteCode: 'EUR',
  rate: 0.9,
  quoteRate: 1.111111,
  custom: true,
  isCustomCurrency: false,
};

// A custom currency's rate row can come back with `custom: false`; the form must still treat it as user-set.
const CUSTOM_CURRENCY = {
  currency: { code: 'SAT' },
  quoteCode: 'USD',
  rate: 0.0000006,
  quoteRate: 1666666.66667,
  custom: false,
  isCustomCurrency: true,
};

const BTC = {
  currency: { code: 'BTC' },
  quoteCode: 'USD',
  rate: 40000,
  quoteRate: 0.000025,
  custom: false,
  isCustomCurrency: true,
};

type DatedRate = { quoteCode: string; rate: number; effectiveDate: string };

const mountForm = ({ currency = ISO_PAIR, datedRate }: { currency?: typeof ISO_PAIR; datedRate?: DatedRate } = {}) => {
  const wrapper = mount(ExchangeRateForm, {
    props: {
      currency: currency as unknown as CurrencyWithExchangeRate,
      isFormDisabled: false,
      datedRate,
    },
    global: { plugins: [i18n] },
  });
  const [baseInput, quoteInput] = wrapper.findAll('input[type="number"]');
  return { wrapper, baseInput: baseInput!, quoteInput: quoteInput! };
};

describe('ExchangeRateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(editUserCurrenciesExchangeRates).mockResolvedValue({ remeasure: { failed: 0 } } as never);
    vi.mocked(deleteCustomRate).mockResolvedValue({ remeasure: { failed: 0 } } as never);
  });

  it('derives the inverse rate and enables Save for a valid rate', async () => {
    const { wrapper, baseInput, quoteInput } = mountForm();

    await baseInput.trigger('focus');
    await baseInput.setValue('0.5');

    expect((quoteInput.element as HTMLInputElement).value).toBe('2');
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
  });

  it('disables Save when a rate is empty', async () => {
    const { wrapper, baseInput } = mountForm();

    await baseInput.trigger('focus');
    await baseInput.setValue('');

    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });

  it('has no date field for an ISO currency, and sends no effective date', async () => {
    const { wrapper, baseInput } = mountForm();

    expect(wrapper.find('[data-testid="manual-rate-effective-date"]').exists()).toBe(false);

    await baseInput.trigger('focus');
    await baseInput.setValue('0.8');
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(editUserCurrenciesExchangeRates).toHaveBeenCalledWith([
      { baseCode: 'USD', quoteCode: 'EUR', rate: 0.8 },
      { baseCode: 'EUR', quoteCode: 'USD', rate: 1.25 },
    ]);
  });

  describe('custom currency', () => {
    it('has no live rate to follow, so the inputs stay editable', () => {
      const { wrapper, baseInput, quoteInput } = mountForm({ currency: CUSTOM_CURRENCY });

      expect(wrapper.findComponent(Checkbox).exists()).toBe(false);
      expect(baseInput.attributes('disabled')).toBeUndefined();
      expect(quoteInput.attributes('disabled')).toBeUndefined();
    });

    it('keeps the significant digits of a tiny inverse rate', async () => {
      const { wrapper, baseInput, quoteInput } = mountForm({ currency: CUSTOM_CURRENCY });

      await quoteInput.trigger('focus');
      await quoteInput.setValue('3000000');

      expect(Number((baseInput.element as HTMLInputElement).value)).toBe(3.33333333333e-7);
      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
    });

    it('leaves the day to the API when the date is left on today, and never drops the rate', async () => {
      const { wrapper, baseInput } = mountForm({ currency: CUSTOM_CURRENCY });

      await baseInput.trigger('focus');
      await baseInput.setValue('0.0000005');
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(editUserCurrenciesExchangeRates).toHaveBeenCalledWith([
        { baseCode: 'SAT', quoteCode: 'USD', rate: 0.0000005 },
        { baseCode: 'USD', quoteCode: 'SAT', rate: 2000000 },
      ]);
      expect(deleteCustomRate).not.toHaveBeenCalled();
    });

    it('saves the rate from the chosen date, and the date alone enables Save', async () => {
      const { wrapper } = mountForm({ currency: BTC });
      const earlier = format(addDays(new Date(), -30), 'yyyy-MM-dd');

      expect(wrapper.find('button').attributes('disabled')).toBeDefined();

      await wrapper.find('[data-testid="manual-rate-effective-date"]').setValue(earlier);
      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(vi.mocked(editUserCurrenciesExchangeRates).mock.calls[0]![0].map((pair) => pair.effectiveDate)).toEqual([
        earlier,
        earlier,
      ]);
      expect(wrapper.emitted('submit')).toHaveLength(1);
    });

    it('resets to today and the stored rate after a back-dated save', async () => {
      const { wrapper, baseInput } = mountForm({ currency: BTC });
      const dateInput = wrapper.find('[data-testid="manual-rate-effective-date"]');

      await dateInput.setValue(format(addDays(new Date(), -30), 'yyyy-MM-dd'));
      await baseInput.trigger('focus');
      await baseInput.setValue('30000');
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect((baseInput.element as HTMLInputElement).value).toBe('40000');
      expect((dateInput.element as HTMLInputElement).value).toBe(format(new Date(), 'yyyy-MM-dd'));
      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('re-seeds the inputs when the rate in force changes under the open form', async () => {
      const { wrapper, baseInput, quoteInput } = mountForm({ currency: BTC });

      await baseInput.trigger('focus');
      await baseInput.setValue('45000');
      await wrapper.setProps({ currency: { ...BTC, rate: 50000, quoteRate: 0.00002 } as never });

      expect((baseInput.element as HTMLInputElement).value).toBe('50000');
      expect((quoteInput.element as HTMLInputElement).value).toBe('0.00002');
      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it("shows the API's refusal, such as a source that is not manual", async () => {
      vi.mocked(editUserCurrenciesExchangeRates).mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'BTC is not manual' }),
      );
      const { wrapper, baseInput } = mountForm({ currency: BTC });

      await baseInput.trigger('focus');
      await baseInput.setValue('30000');
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(mockAddError).toHaveBeenCalledWith('BTC is not manual');
      expect(wrapper.emitted('submit')).toBeUndefined();
    });

    describe('editing a stored rate', () => {
      const STORED = { quoteCode: 'EUR', rate: 2, effectiveDate: '2026-10-02' };

      it('starts from the stored rate and writes its quote and day, with no date field', async () => {
        const { wrapper, baseInput, quoteInput } = mountForm({ currency: BTC, datedRate: STORED });

        expect(wrapper.find('[data-testid="manual-rate-effective-date"]').exists()).toBe(false);
        expect((baseInput.element as HTMLInputElement).value).toBe('2');
        expect((quoteInput.element as HTMLInputElement).value).toBe('0.5');
        expect(wrapper.find('button').attributes('disabled')).toBeDefined();

        await quoteInput.trigger('focus');
        await quoteInput.setValue('0.125');
        await wrapper.find('button').trigger('click');
        await flushPromises();

        expect(editUserCurrenciesExchangeRates).toHaveBeenCalledWith([
          { baseCode: 'BTC', quoteCode: 'EUR', rate: 8, effectiveDate: '2026-10-02' },
          { baseCode: 'EUR', quoteCode: 'BTC', rate: 0.125, effectiveDate: '2026-10-02' },
        ]);
        expect(wrapper.emitted('submit')).toHaveLength(1);
      });
    });
  });

  it('drops both directions of a custom ISO rate when live rate is turned back on', async () => {
    const { wrapper } = mountForm();

    wrapper.findComponent(Checkbox).vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(deleteCustomRate).toHaveBeenCalledWith([
      { baseCode: 'USD', quoteCode: 'EUR' },
      { baseCode: 'EUR', quoteCode: 'USD' },
    ]);
    expect(editUserCurrenciesExchangeRates).not.toHaveBeenCalled();
  });
});
