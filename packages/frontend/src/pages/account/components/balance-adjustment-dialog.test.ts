import formsEn from '@/i18n/locales/chunks/en/forms.json';
import accountEn from '@/i18n/locales/chunks/en/pages/account.json';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';

import BalanceAdjustmentDialog from './balance-adjustment-dialog.vue';

/* ────────────────────────────── Hoisted mocks ────────────────────────── */

const { mockMutateAsync, mockAddSuccess, mockAddError } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockAddSuccess: vi.fn(),
  mockAddError: vi.fn(),
}));

/* ────────────────────────────── Module mocks ─────────────────────────── */

vi.mock('@/composable/use-account-display-balance', async () => {
  const { computed } = await import('vue');
  return {
    useAccountDisplayBalance: ({ account }: { account: { value: { currentBalance: number } } }) => ({
      hasCreditLimitAdjustment: computed(() => false),
      displayBalance: computed(() => account.value.currentBalance),
      displayRefBalance: computed(() => account.value.currentBalance),
    }),
  };
});

vi.mock('@/composable/data-queries/accounts', async () => {
  const { ref } = await import('vue');
  return {
    useAdjustAccountBalance: () => ({
      mutateAsync: mockMutateAsync,
      isPending: ref(false),
    }),
  };
});

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockAddSuccess,
    addErrorNotification: mockAddError,
  }),
}));

// Mock storeToRefs to just pass through — our mock store already returns refs
vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return {
    ...original,
    storeToRefs: (store: Record<string, unknown>) => store,
  };
});

vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return {
    useCurrenciesStore: () => ({
      currenciesMap: ref({ USD: { currency: { code: 'USD' } } }),
    }),
  };
});

// Stub ResponsiveDialog — renders slots inline without Radix portal overhead
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
            : h('div', {}, [slots.title?.(), slots.default?.({ close }), slots.footer?.({ close })]);
      },
    }),
  };
});

/* ──────────────────────────────── i18n ────────────────────────────────── */

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { ...accountEn, ...formsEn } },
});

/* ─────────────────────────────── Helpers ──────────────────────────────── */

// Shortcut for i18n translations in assertions and element selectors
const t = (key: string) => (i18n.global as unknown as { t: (k: string) => string }).t(key);

const ACCOUNT = {
  id: 42,
  name: 'Test Account',
  currentBalance: 1000,
  currencyCode: 'USD',
  type: 'system',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const mountDialog = (overrides: Record<string, unknown> = {}) =>
  mount(BalanceAdjustmentDialog, {
    props: { account: { ...ACCOUNT, ...overrides } as any },
    global: { plugins: [i18n] },
  });
/* eslint-enable @typescript-eslint/no-explicit-any */

const confirmBtn = (w: VueWrapper) =>
  w.findAll('button').find((b) => b.text().trim() === t('pages.account.balanceAdjustmentDialog.confirm'))!;

const amountInput = (w: VueWrapper) => w.find('input[type="number"]');

const noteInput = (w: VueWrapper) => w.findAll('input').at(-1)!;

const enterAmountAndSubmit = async (w: VueWrapper, amount: number | string) => {
  await amountInput(w).setValue(String(amount));
  await nextTick();
  await confirmBtn(w).trigger('click');
  await flushPromises();
};

const switchToAdjustBy = async (w: VueWrapper) => {
  const tab = w
    .findAll('button')
    .find((b) => b.text().trim() === t('pages.account.balanceAdjustmentDialog.adjustByAmount'))!;
  await tab.trigger('click');
  await nextTick();
};

/* ──────────────────────────────── Tests ───────────────────────────────── */

describe('BalanceAdjustmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({
      transaction: { id: 1 },
      previousBalance: 1000,
      newBalance: 1500,
    });
  });

  describe('submit protection', () => {
    it('disables confirm when no amount is entered', () => {
      const w = mountDialog();
      expect(confirmBtn(w).attributes('disabled')).toBeDefined();
    });

    it('disables confirm when target equals current balance', async () => {
      const w = mountDialog();
      await amountInput(w).setValue('1000');
      await nextTick();
      expect(confirmBtn(w).attributes('disabled')).toBeDefined();
    });

    it('enables confirm when target differs from current balance', async () => {
      const w = mountDialog();
      await amountInput(w).setValue('1500');
      await nextTick();
      expect(confirmBtn(w).attributes('disabled')).toBeUndefined();
    });

    it('drops decimals past the 2 a USD account stores before submitting', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, 100.123);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetBalance: 100.12 }));
    });

    it('keeps 3 decimals for a KWD account', async () => {
      const w = mountDialog({ currencyCode: 'KWD' });
      await enterAmountAndSubmit(w, 100.1234);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetBalance: 100.123 }));
    });

    it('drops the fraction for a JPY account', async () => {
      const w = mountDialog({ currencyCode: 'JPY' });
      await enterAmountAndSubmit(w, 1500.6);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetBalance: 1500 }));
    });

    it('allows submit for amount with exactly 2 decimal places', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, 1500.99);

      expect(mockMutateAsync).toHaveBeenCalled();
    });
  });

  describe('set-to mode', () => {
    it('sends entered amount as targetBalance', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, 2500);

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          targetBalance: 2500,
          note: undefined,
        }),
      );
    });

    it('includes note when provided', async () => {
      const w = mountDialog();
      await amountInput(w).setValue('2500');
      await noteInput(w).setValue('Bank reconciliation');
      await nextTick();
      await confirmBtn(w).trigger('click');
      await flushPromises();

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          targetBalance: 2500,
          note: 'Bank reconciliation',
        }),
      );
    });

    it('omits note when field is empty', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, 2500);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ note: undefined }));
    });

    it('allows negative target for debt accounts', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, -500);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetBalance: -500 }));
    });
  });

  describe('adjust-by mode', () => {
    it('computes target = currentBalance + amount for income', async () => {
      const w = mountDialog();
      await switchToAdjustBy(w);
      await enterAmountAndSubmit(w, 300);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetBalance: 1300 }));
    });

    it('computes target = currentBalance - amount for expense', async () => {
      const w = mountDialog();
      await switchToAdjustBy(w);

      const expenseBtn = w
        .findAll('button')
        .find((b) => b.text().trim() === t('pages.account.balanceAdjustmentDialog.expense'))!;
      await expenseBtn.trigger('click');
      await nextTick();

      await enterAmountAndSubmit(w, 200);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetBalance: 800 }));
    });

    it('disables confirm when amount results in zero diff', async () => {
      const w = mountDialog();
      await switchToAdjustBy(w);
      await amountInput(w).setValue('0');
      await nextTick();

      expect(confirmBtn(w).attributes('disabled')).toBeDefined();
    });
  });

  describe('notifications and dialog lifecycle', () => {
    it('shows success notification on successful submit', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, 2000);

      expect(mockAddSuccess).toHaveBeenCalledWith(t('pages.account.balanceAdjustmentDialog.successNotification'));
    });

    it('emits close on successful submit', async () => {
      const w = mountDialog();
      await enterAmountAndSubmit(w, 2000);

      expect(w.emitted('close')).toHaveLength(1);
    });

    it('shows error notification when mutation rejects', async () => {
      mockMutateAsync.mockRejectedValueOnce(new Error('Server error'));

      const w = mountDialog();
      await enterAmountAndSubmit(w, 2000);

      expect(mockAddError).toHaveBeenCalledWith(t('pages.account.balanceAdjustmentDialog.errorNotification'));
    });

    it('does not close dialog on mutation failure', async () => {
      mockMutateAsync.mockRejectedValueOnce(new Error('Server error'));

      const w = mountDialog();
      await enterAmountAndSubmit(w, 2000);

      expect(w.emitted('close')).toBeUndefined();
    });

    it('does not show success notification on mutation failure', async () => {
      mockMutateAsync.mockRejectedValueOnce(new Error('Server error'));

      const w = mountDialog();
      await enterAmountAndSubmit(w, 2000);

      expect(mockAddSuccess).not.toHaveBeenCalled();
    });
  });

  describe('mode switching', () => {
    it('resets amount when switching modes', async () => {
      const w = mountDialog();
      await amountInput(w).setValue('5000');
      await nextTick();

      // Confirm should be enabled before switch
      expect(confirmBtn(w).attributes('disabled')).toBeUndefined();

      await switchToAdjustBy(w);

      // Amount cleared, confirm disabled again
      expect((amountInput(w).element as HTMLInputElement).value).toBe('');
      expect(confirmBtn(w).attributes('disabled')).toBeDefined();
    });
  });
});
