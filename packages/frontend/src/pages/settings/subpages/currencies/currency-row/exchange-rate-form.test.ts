import { deleteCustomRate, editUserCurrenciesExchangeRates } from '@/api/currencies';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import ExchangeRateForm from './exchange-rate-form.vue';

vi.mock('@/api/currencies', () => ({
  deleteCustomRate: vi.fn(),
  editUserCurrenciesExchangeRates: vi.fn(),
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: vi.fn(),
    addWarningNotification: vi.fn(),
    addErrorNotification: vi.fn(),
  }),
}));

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

const mountForm = ({ currency = ISO_PAIR }: { currency?: typeof ISO_PAIR } = {}) => {
  const wrapper = mount(ExchangeRateForm, {
    props: {
      currency: currency as unknown as CurrencyWithExchangeRate,
      isFormDisabled: false,
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

    it('saves both legs against the base and never drops the rate', async () => {
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
