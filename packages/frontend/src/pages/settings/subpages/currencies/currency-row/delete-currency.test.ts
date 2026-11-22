import { deleteCustomCurrency, deleteUserCurrency } from '@/api/currencies';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import DeleteCurrency from './delete-currency.vue';

vi.mock('@/api/currencies', () => ({
  deleteCustomCurrency: vi.fn(),
  deleteUserCurrency: vi.fn(),
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: vi.fn(), addErrorNotification: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      settings: {
        currencies: {
          dialog: {
            footer: {
              deleteBlocked:
                "Used by {count} account, so it can't be deleted. | Used by {count} accounts, so it can't be deleted.",
            },
          },
        },
      },
    },
  },
});

// Renders the dialog inline; its confirm button stands in for the real confirm action.
const AlertDialogStub = defineComponent({
  props: { open: Boolean, confirmDisabled: Boolean },
  emits: ['confirm', 'update:open'],
  setup:
    (props, { slots, emit }) =>
    () =>
      props.open
        ? h('div', { 'data-testid': 'dialog' }, [
            slots.description?.(),
            slots.default?.(),
            h('button', { 'data-testid': 'confirm', disabled: props.confirmDisabled, onClick: () => emit('confirm') }),
          ])
        : null,
});

const mountDelete = ({
  currency,
  accountsCount = 0,
}: {
  currency: Partial<CurrencyWithExchangeRate>;
  accountsCount?: number;
}) =>
  mount(DeleteCurrency, {
    props: {
      currency: currency as CurrencyWithExchangeRate,
      isFormDisabled: false,
      accountsCount,
    },
    global: {
      plugins: [i18n, [VueQueryPlugin, { queryClient: new QueryClient() }]],
      stubs: { ResponsiveAlertDialog: AlertDialogStub },
    },
  });

const confirmDelete = async ({ wrapper }: { wrapper: ReturnType<typeof mountDelete> }) => {
  await wrapper.find('button').trigger('click');
  await wrapper.get('[data-testid="confirm"]').trigger('click');
  await flushPromises();
};

describe('DeleteCurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteCustomCurrency).mockResolvedValue(undefined);
    vi.mocked(deleteUserCurrency).mockResolvedValue(undefined as never);
  });

  it('deletes the definition of a custom currency', async () => {
    const wrapper = mountDelete({ currency: { currencyCode: 'USDT', isCustomCurrency: true } });

    await confirmDelete({ wrapper });

    expect(deleteCustomCurrency).toHaveBeenCalledWith({ code: 'USDT' });
    expect(deleteUserCurrency).not.toHaveBeenCalled();
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('unlinks an ISO currency', async () => {
    const wrapper = mountDelete({ currency: { currencyCode: 'EUR', isCustomCurrency: false } });

    await confirmDelete({ wrapper });

    expect(deleteUserCurrency).toHaveBeenCalledWith('EUR');
    expect(deleteCustomCurrency).not.toHaveBeenCalled();
  });

  it('lists what still uses the currency and blocks the delete', async () => {
    vi.mocked(deleteCustomCurrency).mockRejectedValue(
      new ApiErrorResponseError('in use', {
        code: API_ERROR_CODES.currencyInUse,
        message: 'in use',
        details: { blockers: [{ type: 'goal', id: '1', name: 'Trip' }] },
      }),
    );
    const wrapper = mountDelete({ currency: { currencyCode: 'USDT', isCustomCurrency: true } });

    await confirmDelete({ wrapper });

    expect(wrapper.get('[data-testid="currency-blocker-list"]').text()).toContain('Trip');
    expect(wrapper.get('[data-testid="confirm"]').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('says why a currency accounts use cannot be deleted, and offers no delete', () => {
    const wrapper = mountDelete({ currency: { currencyCode: 'EUR', isCustomCurrency: false }, accountsCount: 2 });

    expect(wrapper.get('[data-testid="delete-currency-blocked"]').text()).toBe(
      "Used by 2 accounts, so it can't be deleted.",
    );
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
