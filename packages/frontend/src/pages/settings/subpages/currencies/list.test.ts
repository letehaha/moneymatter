import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import CurrenciesList from './list.vue';

const { state, mockRefresh, submitStub, overviewStub } = vi.hoisted(() => ({
  overviewStub: async (testId: string) => {
    const { defineComponent, h } = await import('vue');
    return { default: defineComponent({ setup: () => () => h('div', { 'data-testid': testId }) }) };
  },
  state: { currencies: [] as unknown[] },
  mockRefresh: vi.fn(),
  submitStub: async (testId: string) => {
    const { defineComponent, h } = await import('vue');
    return {
      default: defineComponent({
        emits: ['submit'],
        setup:
          (_props, { emit }) =>
          () =>
            h('button', { 'data-testid': testId, onClick: () => emit('submit') }),
      }),
    };
  },
}));

vi.mock('@/api/currencies', () => ({
  loadUserCurrenciesExchangeRates: vi.fn().mockResolvedValue([]),
}));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('@/stores', async () => {
  const { computed, ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currencies: computed(() => state.currencies),
      baseCurrency: computed(() => state.currencies[0]),
    }),
    useAccountsStore: () => ({ accounts: ref([]) }),
  };
});

vi.mock('@/composable', () => ({
  useCurrencyName: () => ({
    getCurrencyName: ({ code, fallbackName }: { code: string; fallbackName?: string }) => fallbackName ?? code,
  }),
}));

vi.mock('./use-refresh-after-currency-change', () => ({ useRefreshAfterCurrencyChange: () => mockRefresh }));

vi.mock('@/components/common/currency-icon.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return { default: defineComponent({ setup: () => () => h('span') }) };
});

vi.mock('./currency-dialog/iso-rate-panel.vue', () => submitStub('rate-form'));
vi.mock('./currency-row/set-base-currency.vue', () => submitStub('set-base'));
vi.mock('./currency-row/delete-currency.vue', () => submitStub('delete-currency'));

vi.mock('./currency-dialog/rate-summary.vue', () => overviewStub('rate-summary'));
vi.mock('./currency-dialog/source-summary-row.vue', () => overviewStub('source-summary-row'));
vi.mock('./currency-dialog/recent-rates.vue', () => overviewStub('recent-rates'));
vi.mock('./currency-dialog/discard-changes-dialog.vue', () => overviewStub('discard-changes-dialog'));
vi.mock('./currency-dialog/rate-history-view.vue', () => overviewStub('rate-history-view'));
vi.mock('./currency-dialog/rate-source-view.vue', () => overviewStub('rate-source-view'));

vi.mock('./custom-currency-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean, currency: { type: Object, default: null }, accountsCount: Number },
      emits: ['update:open'],
      setup: (props) => () =>
        props.open ? h('div', { 'data-testid': 'custom-currency-dialog' }, props.currency?.code) : null,
    }),
  };
});

vi.mock('@/components/common/responsive-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean },
      emits: ['update:open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', { 'data-testid': 'edit-dialog' }, [slots.title?.(), slots.default?.()]) : null,
    }),
  };
});

const userCurrency = ({
  code,
  name,
  isBase = false,
  isCustom = false,
}: {
  code: string;
  name: string;
  isBase?: boolean;
  isCustom?: boolean;
}) => ({
  id: code,
  currencyCode: code,
  isDefaultCurrency: isBase,
  currency: { code, currency: name, digits: 2, symbol: null, isCustom, isDisabled: false, number: 0 },
  rateSource: 'manual',
  rateSourceConfig: null,
});

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } });

const mountList = () =>
  mount(CurrenciesList, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient: new QueryClient() }]] } });

const rowButton = (wrapper: VueWrapper, name: string) =>
  wrapper.findAll('button').find((button) => button.text().includes(name))!;

const dialog = (wrapper: VueWrapper) => wrapper.find('[data-testid="edit-dialog"]');

describe('CurrenciesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currencies = [
      userCurrency({ code: 'USD', name: 'US Dollar', isBase: true }),
      userCurrency({ code: 'EUR', name: 'Euro' }),
      userCurrency({ code: 'USDT', name: 'Tether', isCustom: true }),
    ];
  });

  it('opens one dialog for the clicked currency and leaves the base row inert', async () => {
    const wrapper = mountList();
    await flushPromises();

    expect(wrapper.findAll('button').some((button) => button.text().includes('US Dollar'))).toBe(false);
    expect(dialog(wrapper).exists()).toBe(false);

    await rowButton(wrapper, 'Euro').trigger('click');

    expect(dialog(wrapper).text()).toContain('Euro');
    expect(wrapper.find('[data-testid="set-base"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="edit-custom-currency"]').exists()).toBe(false);
  });

  it.each(['rate-form', 'set-base', 'delete-currency'])('closes and refreshes after %s submits', async (testId) => {
    const wrapper = mountList();
    await flushPromises();

    await rowButton(wrapper, 'Euro').trigger('click');
    await wrapper.get(`[data-testid="${testId}"]`).trigger('click');

    expect(dialog(wrapper).exists()).toBe(false);
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it('shows a custom currency its recent rates and source instead of the live-rate panel', async () => {
    const wrapper = mountList();
    await flushPromises();

    await rowButton(wrapper, 'Tether').trigger('click');

    expect(wrapper.find('[data-testid="rate-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="recent-rates"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="source-summary-row"]').exists()).toBe(true);
  });

  it('swaps to the custom currency dialog instead of stacking it', async () => {
    const wrapper = mountList();
    await flushPromises();

    await rowButton(wrapper, 'Tether').trigger('click');
    await wrapper.get('[data-testid="edit-custom-currency"]').trigger('click');

    expect(dialog(wrapper).exists()).toBe(false);
    expect(wrapper.get('[data-testid="custom-currency-dialog"]').text()).toBe('USDT');
  });
});
