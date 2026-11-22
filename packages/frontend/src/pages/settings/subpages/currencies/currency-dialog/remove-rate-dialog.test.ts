import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyRateHistoryItem } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { addDays, format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import RemoveRateDialog from './remove-rate-dialog.vue';

const { mockLoad, mockDelete, mockAddSuccess, mockAddError, mockAddWarning, mockRefresh } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockDelete: vi.fn(),
  mockAddSuccess: vi.fn(),
  mockAddError: vi.fn(),
  mockAddWarning: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/api/currencies', () => ({ loadCurrencyRateHistory: mockLoad, deleteCustomRate: mockDelete }));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockAddSuccess,
    addErrorNotification: mockAddError,
    addWarningNotification: mockAddWarning,
  }),
}));

vi.mock('../use-refresh-after-currency-change', () => ({ useRefreshAfterCurrencyChange: () => mockRefresh }));
vi.mock('@/composable/use-date-locale', () => ({ getDateFnsLocale: () => enUS }));

vi.mock('@/components/common/responsive-alert-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveAlertDialogStub',
      props: { open: { type: Boolean, default: false }, confirmDisabled: Boolean },
      emits: ['update:open', 'confirm'],
      setup(props, { emit, slots }) {
        return () =>
          props.open
            ? h('div', { 'data-testid': 'remove-dialog' }, [
                h('h2', {}, slots.title?.()),
                slots.description?.(),
                h('button', {
                  'data-testid': 'confirm',
                  disabled: props.confirmDisabled,
                  onClick: () => emit('confirm'),
                }),
              ])
            : null;
      },
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
      common: commonEn.common,
      settings: {
        ...commonEn.settings,
        ...currenciesEn.settings,
        currencies: currenciesEn.settings.currencies,
      },
    },
  },
});

const buildRate = (patch: Partial<CurrencyRateHistoryItem> = {}): CurrencyRateHistoryItem => ({
  quoteCode: 'USD',
  rate: 1,
  effectiveDate: '2026-10-01',
  source: 'manual',
  writtenAt: '2026-10-01T10:00:00.000Z',
  isInForce: false,
  ...patch,
});

const LATEST = buildRate({ rate: 4, effectiveDate: '2026-10-12', isInForce: true });
const OLDER = buildRate({ rate: 2, effectiveDate: '2026-10-02' });

const USDT = {
  currencyCode: 'USDT',
  currency: { code: 'USDT' },
  quoteCode: 'USD',
  rate: 4,
  quoteRate: 0.25,
  custom: false,
  isCustomCurrency: true,
} as unknown as CurrencyWithExchangeRate;

const mountDialog = async ({
  rate,
  items = [LATEST, OLDER],
  isLoadFailed = false,
}: {
  rate: CurrencyRateHistoryItem;
  items?: CurrencyRateHistoryItem[];
  isLoadFailed?: boolean;
}) => {
  if (isLoadFailed) mockLoad.mockRejectedValue(new Error('offline'));
  else mockLoad.mockResolvedValue({ items, totalCount: items.length });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(RemoveRateDialog, {
    props: { open: true, currency: USDT, rate, 'onUpdate:open': (open: boolean) => wrapper.setProps({ open }) },
    global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return wrapper;
};

const description = (wrapper: VueWrapper) => wrapper.find('[data-testid="remove-rate-description"]').text();
const confirm = (wrapper: VueWrapper) => wrapper.find('[data-testid="confirm"]');

describe('RemoveRateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete.mockResolvedValue({ remeasure: { failed: 0 } });
  });

  it('removes a rate through both directions of its pair, with its day, then closes and refreshes', async () => {
    mockDelete.mockResolvedValue({ remeasure: { failed: 2 } });
    const wrapper = await mountDialog({ rate: OLDER, items: [LATEST, OLDER, buildRate()] });

    expect(wrapper.text()).toContain('Remove the Oct 2, 2026 rate?');
    await confirm(wrapper).trigger('click');
    await flushPromises();

    expect(mockDelete).toHaveBeenCalledWith([
      { baseCode: 'USDT', quoteCode: 'USD', effectiveDate: '2026-10-02' },
      { baseCode: 'USD', quoteCode: 'USDT', effectiveDate: '2026-10-02' },
    ]);
    expect(mockAddSuccess).toHaveBeenCalledWith('Rate removed');
    expect(mockAddWarning).toHaveBeenCalledOnce();
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(wrapper.emitted('removed')).toHaveLength(1);
    expect(wrapper.emitted('update:removing')).toEqual([[true], [false]]);
    expect(wrapper.find('[data-testid="remove-dialog"]').exists()).toBe(false);
  });

  it('still removes the rate when the stored rates failed to load, naming no days', async () => {
    const wrapper = await mountDialog({ rate: OLDER, isLoadFailed: true });

    expect(description(wrapper)).toContain(
      'The value of your USDT transactions on those days is recalculated. Their USDT amounts stay the same.',
    );
    expect(description(wrapper)).not.toContain('– now');
    expect(confirm(wrapper).attributes('disabled')).toBeUndefined();

    await confirm(wrapper).trigger('click');
    await flushPromises();

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(wrapper.emitted('removed')).toHaveLength(1);
  });

  it('keeps Confirm disabled while the removal runs', async () => {
    let finish: (value: unknown) => void = () => {};
    mockDelete.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = await mountDialog({ rate: OLDER });

    await confirm(wrapper).trigger('click');
    expect(confirm(wrapper).attributes('disabled')).toBeDefined();

    finish({ remeasure: { updated: 0, failed: 0 } });
    await flushPromises();
    expect(wrapper.emitted('removed')).toHaveLength(1);
  });

  it('says the older rate takes over the days of the removed one', async () => {
    const wrapper = await mountDialog({ rate: OLDER, items: [LATEST, OLDER, buildRate({ rate: 1.5 })] });

    expect(description(wrapper)).toBe(
      'Oct 2 – Oct 11, 2026 will use the Oct 1, 2026 rate instead (1 USDT = 1.5 USD). The value of your USDT transactions on those days is recalculated. Their USDT amounts stay the same.',
    );
  });

  it('says the days of the latest rate onward fall back to the one before it', async () => {
    const wrapper = await mountDialog({ rate: LATEST });

    expect(description(wrapper)).toContain(
      'Oct 12, 2026 – now will use the Oct 2, 2026 rate instead (1 USDT = 2 USD).',
    );
  });

  it('says the next newer rate takes over every earlier day when the earliest rate is removed', async () => {
    const wrapper = await mountDialog({ rate: OLDER });

    expect(description(wrapper)).toContain(
      'Oct 2 – Oct 11, 2026 and every day before will use the Oct 12, 2026 rate instead (1 USDT = 4 USD).',
    );
  });

  it('names no rate when the older neighbour is not loaded', async () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      buildRate({ effectiveDate: format(addDays(new Date(2026, 9, 31), -index), 'yyyy-MM-dd') }),
    );
    const wrapper = await mountDialog({ rate: items.at(-1)!, items });

    expect(description(wrapper)).toContain('Oct 12, 2026 will use the previous rate instead.');
  });

  it('refuses to remove the last rate', async () => {
    const wrapper = await mountDialog({ rate: LATEST, items: [LATEST] });

    expect(description(wrapper)).toBe('A currency needs at least one rate.');
    expect(confirm(wrapper).attributes('disabled')).toBeDefined();
  });

  it('reports the refusal and stays open when the removal fails', async () => {
    mockDelete.mockRejectedValue(
      new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Rate refused' }),
    );
    const wrapper = await mountDialog({ rate: OLDER });

    await confirm(wrapper).trigger('click');
    await flushPromises();

    expect(mockAddError).toHaveBeenCalledWith('Rate refused');
    expect(mockAddSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(wrapper.emitted('removed')).toBeUndefined();
    expect(wrapper.find('[data-testid="remove-dialog"]').exists()).toBe(true);
  });

  it('shows no toast for a refusal the API client already handled', async () => {
    mockDelete.mockRejectedValue(
      new ApiErrorResponseError('plan', { code: API_ERROR_CODES.planRequired, message: 'Upgrade' }),
    );
    const wrapper = await mountDialog({ rate: OLDER });

    await confirm(wrapper).trigger('click');
    await flushPromises();

    expect(mockAddError).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="remove-dialog"]').exists()).toBe(true);
  });
});
