import { deleteCustomRate, editUserCurrenciesExchangeRates } from '@/api/currencies';
import { Switch } from '@/components/lib/ui/switch';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import IsoRatePanel from './iso-rate-panel.vue';

vi.mock('@/api/currencies', () => ({
  deleteCustomRate: vi.fn(),
  editUserCurrenciesExchangeRates: vi.fn(),
}));

const { mockAddError, mockAddWarning } = vi.hoisted(() => ({ mockAddError: vi.fn(), mockAddWarning: vi.fn() }));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: vi.fn(),
    addWarningNotification: mockAddWarning,
    addErrorNotification: mockAddError,
  }),
}));

vi.mock('@/components/common/responsive-alert-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: { type: Boolean, default: false } },
      emits: ['update:open', 'confirm'],
      setup:
        (props, { emit, slots }) =>
        () =>
          props.open
            ? h('div', { 'data-testid': 'live-rate-confirm' }, [
                slots.description?.(),
                h('button', { 'data-testid': 'confirm', onClick: () => emit('confirm') }),
                h('button', { 'data-testid': 'cancel', onClick: () => emit('update:open', false) }),
              ])
            : null,
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      settings: {
        currencies: { dialog: { iso: { confirmBody: 'Drop {rate}' }, row: { rate: '1 {code} = {rate} {quote}' } } },
      },
    },
  },
});

// 1 USD = 0.9 EUR, with the base currency EUR; `custom` marks a rate the user saved.
const OWN_RATE = {
  currencyCode: 'USD',
  currency: { code: 'USD' },
  quoteCode: 'EUR',
  rate: 0.9,
  quoteRate: 1.111111,
  custom: true,
  isCustomCurrency: false,
};
const LIVE_RATE = { ...OWN_RATE, custom: false };

const mountPanel = ({ currency = OWN_RATE }: { currency?: typeof OWN_RATE } = {}) =>
  mount(IsoRatePanel, {
    props: { currency: currency as unknown as CurrencyWithExchangeRate, isFormDisabled: false },
    global: { plugins: [i18n] },
  });

const input = (wrapper: VueWrapper, testId: string) => wrapper.find(`input[data-testid="${testId}"]`);
const save = (wrapper: VueWrapper) => wrapper.find('[data-testid="manual-rate-save"]');
const typeRate = async ({ wrapper, testId, value }: { wrapper: VueWrapper; testId: string; value: string }) => {
  await input(wrapper, testId).trigger('focus');
  await input(wrapper, testId).setValue(value);
};
const isLiveOn = (wrapper: VueWrapper) =>
  wrapper.get('[data-testid="iso-live-rate-switch"]').attributes('aria-checked');
const toggleLive = async ({ wrapper, value }: { wrapper: VueWrapper; value: boolean }) => {
  wrapper.findComponent(Switch).vm.$emit('update:modelValue', value);
  await flushPromises();
};

describe('IsoRatePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(editUserCurrenciesExchangeRates).mockResolvedValue({ remeasure: { failed: 0 } } as never);
    vi.mocked(deleteCustomRate).mockResolvedValue({ remeasure: { failed: 0 } } as never);
  });

  it('derives the inverse rate and enables Save for a valid rate', async () => {
    const wrapper = mountPanel();

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.5' });

    expect(input(wrapper, 'manual-rate-quote').element).toHaveProperty('value', '2');
    expect(save(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('disables Save when a rate is empty', async () => {
    const wrapper = mountPanel();

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '' });

    expect(save(wrapper).attributes('disabled')).toBeDefined();
  });

  it('has no date field and sends no effective date, then reports the save', async () => {
    const wrapper = mountPanel();

    expect(wrapper.find('[data-testid="manual-rate-effective-date"]').exists()).toBe(false);

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.8' });
    await save(wrapper).trigger('click');
    await flushPromises();

    expect(editUserCurrenciesExchangeRates).toHaveBeenCalledWith([
      { baseCode: 'USD', quoteCode: 'EUR', rate: 0.8 },
      { baseCode: 'EUR', quoteCode: 'USD', rate: 1.25 },
    ]);
    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect(wrapper.emitted('trigger-disabled')).toEqual([[true], [false]]);
  });

  it('warns when some balances could not be refreshed with the new rate', async () => {
    vi.mocked(editUserCurrenciesExchangeRates).mockResolvedValue({ remeasure: { failed: 2 } } as never);
    const wrapper = mountPanel();

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.8' });
    await save(wrapper).trigger('click');
    await flushPromises();

    expect(mockAddWarning).toHaveBeenCalledOnce();
  });

  it("shows the API's refusal and keeps the panel", async () => {
    vi.mocked(editUserCurrenciesExchangeRates).mockRejectedValue(
      new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Rate is too large' }),
    );
    const wrapper = mountPanel();

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.8' });
    await save(wrapper).trigger('click');
    await flushPromises();

    expect(mockAddError).toHaveBeenCalledWith('Rate is too large');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('hides the inputs while the live rate is on, and turning it off reveals them', async () => {
    const wrapper = mountPanel({ currency: LIVE_RATE });

    expect(input(wrapper, 'manual-rate-base').exists()).toBe(false);

    await toggleLive({ wrapper, value: false });

    expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '0.9');
    expect(wrapper.find('[data-testid="iso-rate-note"]').exists()).toBe(true);
  });

  it('turns the live rate back on without asking when no own rate was saved', async () => {
    const wrapper = mountPanel({ currency: LIVE_RATE });

    await toggleLive({ wrapper, value: false });
    await toggleLive({ wrapper, value: true });

    expect(wrapper.find('[data-testid="live-rate-confirm"]').exists()).toBe(false);
    expect(input(wrapper, 'manual-rate-base').exists()).toBe(false);
    expect(deleteCustomRate).not.toHaveBeenCalled();
  });

  it('drops both directions of the own rate once the user confirms going back to the live rate', async () => {
    const wrapper = mountPanel();

    await toggleLive({ wrapper, value: true });

    expect(deleteCustomRate).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();

    expect(deleteCustomRate).toHaveBeenCalledWith([
      { baseCode: 'USD', quoteCode: 'EUR' },
      { baseCode: 'EUR', quoteCode: 'USD' },
    ]);
    expect(editUserCurrenciesExchangeRates).not.toHaveBeenCalled();
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('keeps the own rate when the user cancels going back to the live rate', async () => {
    const wrapper = mountPanel();

    await toggleLive({ wrapper, value: true });
    expect(wrapper.get('[data-testid="live-rate-confirm"]').text()).toContain('Drop 1 EUR = 1.111111 USD');

    await wrapper.get('[data-testid="cancel"]').trigger('click');
    await flushPromises();

    expect(deleteCustomRate).not.toHaveBeenCalled();
    expect(input(wrapper, 'manual-rate-base').exists()).toBe(true);
    expect(isLiveOn(wrapper)).toBe('false');
  });

  it('keeps the own rate and reports the error when removing it fails', async () => {
    vi.mocked(deleteCustomRate).mockRejectedValue(
      new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Could not remove' }),
    );
    const wrapper = mountPanel();

    await toggleLive({ wrapper, value: true });
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();

    expect(mockAddError).toHaveBeenCalledWith('Could not remove');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(isLiveOn(wrapper)).toBe('false');
  });

  it('warns when some balances could not be refreshed after going back to the live rate', async () => {
    vi.mocked(deleteCustomRate).mockResolvedValue({ remeasure: { failed: 2 } } as never);
    const wrapper = mountPanel();

    await toggleLive({ wrapper, value: true });
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();

    expect(mockAddWarning).toHaveBeenCalledOnce();
  });

  it('re-seeds untouched inputs when the rate changes under the open panel', async () => {
    const wrapper = mountPanel();

    await wrapper.setProps({ currency: { ...OWN_RATE, rate: 0.8, quoteRate: 1.25 } as never });

    expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '0.8');
    expect(input(wrapper, 'manual-rate-quote').element).toHaveProperty('value', '1.25');
    expect(save(wrapper).attributes('disabled')).toBeDefined();
  });

  it('keeps a typed rate when the rate reloads under the open panel', async () => {
    const wrapper = mountPanel();

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.7' });
    await wrapper.setProps({ currency: { ...OWN_RATE, rate: 0.8, quoteRate: 1.25 } as never });

    expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '0.7');
    expect(save(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('reports unsaved input while the live rate is off, and clears it once saved', async () => {
    const wrapper = mountPanel({ currency: LIVE_RATE });

    await toggleLive({ wrapper, value: false });
    expect(wrapper.emitted('update:dirty')).toBeUndefined();

    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.8' });
    expect(wrapper.emitted('update:dirty')).toEqual([[true]]);

    await save(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:dirty')!.at(-1)).toEqual([false]);
  });

  it('clears the unsaved flag when the live rate goes back on or the panel unmounts', async () => {
    const wrapper = mountPanel({ currency: LIVE_RATE });

    await toggleLive({ wrapper, value: false });
    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.8' });
    await toggleLive({ wrapper, value: true });
    expect(wrapper.emitted('update:dirty')).toEqual([[true], [false]]);

    await toggleLive({ wrapper, value: false });
    await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.7' });
    wrapper.unmount();
    expect(wrapper.emitted('update:dirty')!.at(-1)).toEqual([false]);
  });

  it('spins Save only for its own save, not while the parent is busy elsewhere', async () => {
    const wrapper = mountPanel();
    await wrapper.setProps({ isFormDisabled: true });

    expect(save(wrapper).attributes('loading')).toBe('false');
  });
});
