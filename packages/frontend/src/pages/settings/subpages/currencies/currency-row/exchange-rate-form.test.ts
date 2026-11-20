import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
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

const mountForm = () => {
  const wrapper = mount(ExchangeRateForm, {
    props: {
      currency: {
        currency: { code: 'USD' },
        quoteCode: 'EUR',
        rate: 0.9,
        quoteRate: 1.111111,
        custom: true,
      } as unknown as CurrencyWithExchangeRate,
      isFormDisabled: false,
    },
    global: { plugins: [i18n] },
  });
  const [baseInput, quoteInput] = wrapper.findAll('input[type="number"]');
  return { wrapper, baseInput: baseInput!, quoteInput: quoteInput! };
};

describe('ExchangeRateForm', () => {
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
});
