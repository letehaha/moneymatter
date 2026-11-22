import commonEn from '@/i18n/locales/chunks/en/common.json';
import currenciesEn from '@/i18n/locales/chunks/en/settings/currencies.json';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyRateHistoryItem } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { addDays, format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import RateFormDialog from './rate-form-dialog.vue';

const { mockLoad, mockEdit, mockDelete, mockAddSuccess, mockAddError, mockAddWarning, mockRefresh, utcDay } =
  vi.hoisted(() => ({
    mockLoad: vi.fn(),
    mockEdit: vi.fn(),
    mockDelete: vi.fn(),
    mockAddSuccess: vi.fn(),
    mockAddError: vi.fn(),
    mockAddWarning: vi.fn(),
    mockRefresh: vi.fn(),
    utcDay: { override: null as string | null },
  }));

// Lets a test put the UTC day ahead of the local one without depending on the runner's time zone.
vi.mock('@/common/utils/date', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/utils/date')>();
  return { ...actual, utcDayKey: (args: { date: Date }) => utcDay.override ?? actual.utcDayKey(args) };
});

vi.mock('@/api/currencies', () => ({
  loadCurrencyRateHistory: mockLoad,
  editUserCurrenciesExchangeRates: mockEdit,
  deleteCustomRate: mockDelete,
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockAddSuccess,
    addErrorNotification: mockAddError,
    addWarningNotification: mockAddWarning,
  }),
}));

vi.mock('../use-refresh-after-currency-change', () => ({ useRefreshAfterCurrencyChange: () => mockRefresh }));
vi.mock('@/composable/use-date-locale', () => ({ getDateFnsLocale: () => enUS }));

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

// The user holds USD and USDT; EUR is a currency the user has not connected.
vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({ currencies: ref([{ currencyCode: 'USD' }, { currencyCode: 'USDT' }]) }),
  };
});

// The dialogs' own chrome (drawer on mobile) is not under test: both render their slots while open.
vi.mock('@/components/common/responsive-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveDialogStub',
      props: { open: { type: Boolean, default: false } },
      setup(props, { slots }) {
        return () =>
          props.open
            ? h('div', { 'data-testid': 'form-dialog' }, [
                h('h2', {}, slots.title?.()),
                h('p', { 'data-testid': 'form-description' }, slots.description?.()),
                slots.default?.(),
                slots.footer?.(),
              ])
            : null;
      },
    }),
  };
});

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

const SAT = {
  currencyCode: 'SAT',
  currency: { code: 'SAT' },
  quoteCode: 'USD',
  rate: 0.0000006,
  quoteRate: 1666666.66667,
  custom: false,
  isCustomCurrency: true,
} as unknown as CurrencyWithExchangeRate;

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
  currency = USDT,
  rate,
  items = [LATEST, OLDER],
  isLoadFailed = false,
  isLoading = false,
}: {
  currency?: CurrencyWithExchangeRate;
  rate?: CurrencyRateHistoryItem;
  items?: CurrencyRateHistoryItem[];
  isLoadFailed?: boolean;
  isLoading?: boolean;
} = {}) => {
  if (isLoading) mockLoad.mockReturnValue(new Promise(() => {}));
  else if (isLoadFailed) mockLoad.mockRejectedValue(new Error('offline'));
  else mockLoad.mockResolvedValue({ items, totalCount: items.length });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(RateFormDialog, {
    props: { open: true, currency, rate, 'onUpdate:open': (open: boolean) => wrapper.setProps({ open }) },
    global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return wrapper;
};

const input = (wrapper: VueWrapper, testId: string) =>
  wrapper.find(`input[data-testid="${testId}"], [data-testid="${testId}"] input`);
const save = (wrapper: VueWrapper) => wrapper.find('[data-testid="manual-rate-save"]');
const dateInput = (wrapper: VueWrapper) => wrapper.find('[data-testid="manual-rate-effective-date"]');
const note = (wrapper: VueWrapper) => wrapper.find('[data-testid="rate-form-note"]');
const isOpen = (wrapper: VueWrapper) => wrapper.find('[data-testid="form-dialog"]').exists();

const typeRate = async ({ wrapper, testId, value }: { wrapper: VueWrapper; testId: string; value: string }) => {
  await input(wrapper, testId).trigger('focus');
  await input(wrapper, testId).setValue(value);
};

describe('RateFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEdit.mockResolvedValue({ rates: [], remeasure: { failed: 0 } });
    mockDelete.mockResolvedValue({ remeasure: { failed: 0 } });
  });

  describe('adding a rate', () => {
    it('starts from the current rate with editable inputs and no live-rate switch', async () => {
      const wrapper = await mountDialog();

      expect(wrapper.text()).toContain('Update rate');
      expect(wrapper.text()).toContain('Set what 1 USDT is worth, starting from a day you choose.');
      expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '4');
      expect(input(wrapper, 'manual-rate-quote').element).toHaveProperty('value', '0.25');
      expect(input(wrapper, 'manual-rate-base').attributes('disabled')).toBeUndefined();
      expect(input(wrapper, 'manual-rate-quote').attributes('disabled')).toBeUndefined();
      expect(wrapper.find('[role="switch"], [role="checkbox"]').exists()).toBe(false);
      expect(save(wrapper).attributes('disabled')).toBeDefined();
    });

    it('derives the inverse rate and disables Save when a rate is empty', async () => {
      const wrapper = await mountDialog();

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.5' });
      expect(input(wrapper, 'manual-rate-quote').element).toHaveProperty('value', '2');
      expect(save(wrapper).attributes('disabled')).toBeUndefined();

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '' });
      expect(save(wrapper).attributes('disabled')).toBeDefined();
    });

    it('keeps the significant digits of a tiny inverse rate', async () => {
      const wrapper = await mountDialog({ currency: SAT });

      await typeRate({ wrapper, testId: 'manual-rate-quote', value: '3000000' });

      expect(Number((input(wrapper, 'manual-rate-base').element as HTMLInputElement).value)).toBe(3.33333333333e-7);
      expect(save(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('leaves the day to the API when the date is left on today, never drops the rate, then closes and refreshes', async () => {
      const wrapper = await mountDialog({ currency: SAT });

      expect(wrapper.find('[data-testid="rate-form-today"]').text()).toBe('Today');

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '0.0000005' });
      await save(wrapper).trigger('click');
      await flushPromises();

      expect(mockEdit).toHaveBeenCalledWith([
        { baseCode: 'SAT', quoteCode: 'USD', rate: 0.0000005 },
        { baseCode: 'USD', quoteCode: 'SAT', rate: 2000000 },
      ]);
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockAddSuccess).toHaveBeenCalledOnce();
      expect(mockRefresh).toHaveBeenCalledOnce();
      expect(isOpen(wrapper)).toBe(false);
    });

    it('warns when some balances could not be refreshed with the new rate', async () => {
      mockEdit.mockResolvedValue({ rates: [], remeasure: { failed: 2 } });
      const wrapper = await mountDialog();

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '5' });
      await save(wrapper).trigger('click');
      await flushPromises();

      expect(mockAddWarning).toHaveBeenCalledOnce();
    });

    it('saves the rate from the chosen date, and the date alone enables Save', async () => {
      const wrapper = await mountDialog();
      const earlier = format(addDays(new Date(), -3), 'yyyy-MM-dd');

      expect(save(wrapper).attributes('disabled')).toBeDefined();

      await dateInput(wrapper).setValue(earlier);
      expect(save(wrapper).attributes('disabled')).toBeUndefined();
      expect(wrapper.find('[data-testid="rate-form-today"]').exists()).toBe(false);

      await save(wrapper).trigger('click');
      await flushPromises();

      expect(mockEdit.mock.calls[0]![0].map((pair: { effectiveDate?: string }) => pair.effectiveDate)).toEqual([
        earlier,
        earlier,
      ]);
    });

    it('reopens on today and the current rate after a back-dated save or a cancel', async () => {
      const wrapper = await mountDialog();

      await dateInput(wrapper).setValue(format(addDays(new Date(), -3), 'yyyy-MM-dd'));
      await typeRate({ wrapper, testId: 'manual-rate-base', value: '30000' });
      await save(wrapper).trigger('click');
      await flushPromises();
      expect(isOpen(wrapper)).toBe(false);

      await wrapper.setProps({ currency: { ...USDT, rate: 5, quoteRate: 0.2 } as CurrencyWithExchangeRate });
      await wrapper.setProps({ open: true });
      expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '5');
      expect(input(wrapper, 'manual-rate-quote').element).toHaveProperty('value', '0.2');
      expect(dateInput(wrapper).element).toHaveProperty('value', format(new Date(), 'yyyy-MM-dd'));
      expect(save(wrapper).attributes('disabled')).toBeDefined();

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '7' });
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Cancel')!
        .trigger('click');
      await wrapper.setProps({ open: true });
      expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '5');
    });

    it("shows the API's refusal, such as a source that is not manual, and stays open", async () => {
      mockEdit.mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'USDT is not manual' }),
      );
      const wrapper = await mountDialog();

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '3' });
      await save(wrapper).trigger('click');
      await flushPromises();

      expect(mockAddError).toHaveBeenCalledWith('USDT is not manual');
      expect(mockRefresh).not.toHaveBeenCalled();
      expect(isOpen(wrapper)).toBe(true);
    });

    it('says a day that already has a rate is replaced, and labels Save so', async () => {
      const wrapper = await mountDialog({ items: [LATEST, OLDER, buildRate()] });

      await dateInput(wrapper).setValue('2026-10-02');

      expect(save(wrapper).text()).toBe('Replace rate');
      expect(note(wrapper).text()).toBe(
        'Oct 2, 2026 already has a rate (2 USD). Saving replaces it. Saving recalculates the value of your USDT transactions dated Oct 2 – Oct 11, 2026. Their USDT amounts stay the same.',
      );
    });

    it('says what a past day with no rate recalculates', async () => {
      const wrapper = await mountDialog();

      await dateInput(wrapper).setValue('2026-09-01');

      expect(save(wrapper).text()).toBe('Save rate');
      expect(note(wrapper).text()).toBe(
        'Saving recalculates the value of your USDT transactions up to Oct 1, 2026. Their USDT amounts stay the same.',
      );
    });

    it('says what a past day after the newest rate recalculates', async () => {
      const wrapper = await mountDialog();

      await dateInput(wrapper).setValue('2026-11-01');

      expect(save(wrapper).text()).toBe('Save rate');
      expect(note(wrapper).text()).toBe(
        'Saving recalculates the value of your USDT transactions from Nov 1, 2026 onward. Their USDT amounts stay the same.',
      );
    });

    it('cannot tell what saving changes when the stored rates failed to load', async () => {
      const wrapper = await mountDialog({ isLoadFailed: true });

      expect(note(wrapper).text()).toBe(
        'If this day already has a rate, saving replaces it. Your USDT transactions from this day until the next rate are recalculated.',
      );
    });

    it('keeps Save off while the stored rates load, so a replaced day is always announced', async () => {
      const wrapper = await mountDialog({ isLoading: true });

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '5' });

      expect(save(wrapper).attributes('disabled')).toBeDefined();
      expect(note(wrapper).exists()).toBe(false);
    });

    it('can still save when the stored rates failed to load', async () => {
      const wrapper = await mountDialog({ isLoadFailed: true });

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '5' });
      expect(save(wrapper).attributes('disabled')).toBeUndefined();
    });

    describe('when the UTC day is already ahead of the local day', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 22, 23, 30));
        utcDay.override = '2026-11-23';
      });

      afterEach(() => {
        utcDay.override = null;
        vi.useRealTimers();
      });

      it('previews today as the UTC day and leaves the day out of the request', async () => {
        const onUtcDay = buildRate({ rate: 3, effectiveDate: '2026-11-23', isInForce: true });
        const wrapper = await mountDialog({ items: [onUtcDay, LATEST] });

        expect(wrapper.find('[data-testid="rate-form-today"]').exists()).toBe(true);
        expect(note(wrapper).text().startsWith('Nov 23, 2026 already has a rate (3 USD).')).toBe(true);

        await typeRate({ wrapper, testId: 'manual-rate-base', value: '5' });
        expect(save(wrapper).text()).toBe('Replace rate');

        await save(wrapper).trigger('click');
        await flushPromises();

        expect(mockEdit).toHaveBeenCalledWith([
          { baseCode: 'USDT', quoteCode: 'USD', rate: 5 },
          { baseCode: 'USD', quoteCode: 'USDT', rate: 0.2 },
        ]);
      });
    });

    it('says saved transactions keep their value for a new rate from today', async () => {
      const wrapper = await mountDialog();

      expect(note(wrapper).text()).toBe('Transactions you already saved keep their value.');
    });

    it('cannot tell what a day older than every loaded rate replaces while older pages exist', async () => {
      const items = Array.from({ length: 20 }, (_, index) =>
        buildRate({ effectiveDate: format(addDays(new Date(2026, 9, 31), -index), 'yyyy-MM-dd') }),
      );
      const wrapper = await mountDialog({ items });

      await dateInput(wrapper).setValue('2026-01-01');

      expect(note(wrapper).text()).toBe(
        'If this day already has a rate, saving replaces it. Your USDT transactions from this day until the next rate are recalculated.',
      );
    });
  });

  describe('editing a stored rate', () => {
    it('starts from the stored rate and writes its quote and day, with no date field, then closes', async () => {
      const stored = buildRate({ quoteCode: 'USD', rate: 2, effectiveDate: '2026-10-02' });
      const wrapper = await mountDialog({ rate: stored, items: [LATEST, stored] });

      expect(wrapper.find('[data-testid="edit-dated-rate"]').exists()).toBe(true);
      expect(dateInput(wrapper).exists()).toBe(false);
      expect(input(wrapper, 'manual-rate-base').element).toHaveProperty('value', '2');
      expect(input(wrapper, 'manual-rate-quote').element).toHaveProperty('value', '0.5');
      expect(save(wrapper).attributes('disabled')).toBeDefined();

      await typeRate({ wrapper, testId: 'manual-rate-quote', value: '0.125' });
      await save(wrapper).trigger('click');
      await flushPromises();

      expect(mockEdit).toHaveBeenCalledWith([
        { baseCode: 'USDT', quoteCode: 'USD', rate: 8, effectiveDate: '2026-10-02' },
        { baseCode: 'USD', quoteCode: 'USDT', rate: 0.125, effectiveDate: '2026-10-02' },
      ]);
      expect(mockRefresh).toHaveBeenCalledOnce();
      expect(isOpen(wrapper)).toBe(false);
    });

    it('describes the days the rate covers and what saving recalculates, and keeps Save labelled Save', async () => {
      const wrapper = await mountDialog({ rate: OLDER, items: [LATEST, OLDER, buildRate()] });

      expect(wrapper.find('[data-testid="form-description"]').text()).toBe('Used for Oct 2 – Oct 11, 2026.');
      expect(note(wrapper).text()).toBe(
        'Saving recalculates the value of your USDT transactions dated Oct 2 – Oct 11, 2026. Their USDT amounts stay the same. To use this rate from another day, remove it and add a new one.',
      );
      expect(save(wrapper).text()).toBe('Save rate');
    });

    it('describes the latest rate as used onward and the earliest as covering every day before', async () => {
      const latest = await mountDialog({ rate: LATEST });
      expect(latest.find('[data-testid="form-description"]').text()).toBe('Used from Oct 12, 2026 onward.');

      const earliest = await mountDialog({ rate: OLDER });
      expect(earliest.find('[data-testid="form-description"]').text()).toBe(
        'Used for Oct 2 – Oct 11, 2026, and for every day before it.',
      );
    });

    it('says editing the only rate recalculates every transaction', async () => {
      const wrapper = await mountDialog({ rate: LATEST, items: [LATEST] });

      expect(wrapper.find('[data-testid="form-description"]').text()).toBe('Used for every day.');
      expect(note(wrapper).text().startsWith('Saving recalculates the value of all your USDT transactions.')).toBe(
        true,
      );
    });

    it('keeps the dialog open and reports the refusal when the edit fails', async () => {
      mockEdit.mockRejectedValue(
        new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Rate refused' }),
      );
      const wrapper = await mountDialog({ rate: LATEST });

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '9' });
      await save(wrapper).trigger('click');
      await flushPromises();

      expect(mockAddError).toHaveBeenCalledWith('Rate refused');
      expect(isOpen(wrapper)).toBe(true);
    });

    it('removes the rate through the remove dialog and closes', async () => {
      const wrapper = await mountDialog({ rate: OLDER });

      await wrapper.find('[data-testid="rate-form-remove"]').trigger('click');
      await wrapper.find('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockDelete).toHaveBeenCalledWith([
        { baseCode: 'USDT', quoteCode: 'USD', effectiveDate: '2026-10-02' },
        { baseCode: 'USD', quoteCode: 'USDT', effectiveDate: '2026-10-02' },
      ]);
      expect(isOpen(wrapper)).toBe(false);
    });

    it('lets the rate be removed when the stored rates failed to load', async () => {
      const wrapper = await mountDialog({ rate: OLDER, isLoadFailed: true });

      expect(wrapper.find('[data-testid="rate-form-remove"]').attributes('disabled')).toBeUndefined();
      expect(wrapper.find('[data-testid="rate-form-last-rate"]').exists()).toBe(false);

      await wrapper.find('[data-testid="rate-form-remove"]').trigger('click');
      expect(wrapper.find('[data-testid="confirm"]').attributes('disabled')).toBeUndefined();
      await wrapper.find('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockDelete).toHaveBeenCalledOnce();
      expect(isOpen(wrapper)).toBe(false);
    });

    it('locks the form while the removal runs, so a save cannot race it', async () => {
      let finish: (value: unknown) => void = () => {};
      mockDelete.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const wrapper = await mountDialog({ rate: OLDER });

      await typeRate({ wrapper, testId: 'manual-rate-base', value: '9' });
      expect(save(wrapper).attributes('disabled')).toBeUndefined();

      await wrapper.find('[data-testid="rate-form-remove"]').trigger('click');
      await wrapper.find('[data-testid="confirm"]').trigger('click');

      expect(save(wrapper).attributes('disabled')).toBeDefined();
      expect(input(wrapper, 'manual-rate-base').attributes('disabled')).toBeDefined();
      expect(wrapper.find('[data-testid="rate-form-remove"]').attributes('disabled')).toBeDefined();
      expect(
        wrapper
          .findAll('button')
          .find((button) => button.text() === 'Cancel')!
          .attributes('disabled'),
      ).toBeDefined();
      expect(wrapper.find('[data-testid="form-dialog"]').attributes('dismissible')).toBe('false');

      finish({ remeasure: { updated: 0, failed: 0 } });
      await flushPromises();

      expect(mockEdit).not.toHaveBeenCalled();
      expect(isOpen(wrapper)).toBe(false);
    });

    it('offers no remove for the only rate, since a custom currency always keeps one', async () => {
      const wrapper = await mountDialog({ rate: LATEST, items: [LATEST] });

      expect(wrapper.find('[data-testid="rate-form-remove"]').attributes('disabled')).toBeDefined();
      expect(wrapper.find('[data-testid="rate-form-last-rate"]').text()).toBe('A currency needs at least one rate.');
    });

    it('lets a rate quoted in a currency the user does not hold be removed but not edited', async () => {
      const unheld = buildRate({ quoteCode: 'EUR', rate: 0.9, effectiveDate: '2026-09-01', source: 'coingecko' });
      const wrapper = await mountDialog({ rate: unheld, items: [LATEST, unheld] });

      expect(input(wrapper, 'manual-rate-base').attributes('disabled')).toBeDefined();
      expect(input(wrapper, 'manual-rate-quote').attributes('disabled')).toBeDefined();
      expect(save(wrapper).exists()).toBe(false);
      expect(wrapper.find('[data-testid="rate-history-connect-note"]').text()).toBe('Connect EUR to edit this rate.');

      await wrapper.find('[data-testid="rate-form-remove"]').trigger('click');
      await wrapper.find('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockDelete).toHaveBeenCalledWith([
        { baseCode: 'USDT', quoteCode: 'EUR', effectiveDate: '2026-09-01' },
        { baseCode: 'EUR', quoteCode: 'USDT', effectiveDate: '2026-09-01' },
      ]);
    });
  });
});
