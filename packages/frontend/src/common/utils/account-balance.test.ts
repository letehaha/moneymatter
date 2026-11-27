import type * as Pinia from 'pinia';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import { computeAccountDisplayBalances, computeCreditUsed } from './account-balance';
import CreditUtilizationWidget from '@/components/widgets/credit-utilization-widget.vue';
const state = vi.hoisted(() => ({ accounts: [] as object[], includeCreditLimit: false }));

vi.mock('@/stores', () => ({ useAccountsStore: () => ({}), useCurrenciesStore: () => ({}) }));
vi.mock('pinia', async (original) => ({
  ...(await original<typeof Pinia>()),
  storeToRefs: () => ({ accounts: ref(state.accounts), isAccountsFetched: ref(true), baseCurrency: ref({ currency: { code: 'USD' } }) }),
}));
vi.mock('@/composable/data-queries/user-settings', () => ({
  useUserSettings: () => ({ data: ref({ includeCreditLimitInStats: state.includeCreditLimit }) }),
}));
vi.mock('@/composable/formatters', () => ({
  useFormatCurrency: () => ({
    formatBaseCurrency: (amount: number) => `$${amount}`,
    formatAccountAmount: ({ amount }: { amount: number }) => `$${amount}`,
    formatCompactAmount: (amount: number) => `$${amount}`,
  }),
}));
vi.mock('@/composable/use-animated-number', () => ({ useAnimatedNumber: ({ value }: { value: unknown }) => ({ displayValue: value }) }));
vi.mock('@/js/helpers', () => ({ formatCompactUIAmount: ({ amount }: { amount: number }) => `$${amount}` }));

describe('computeCreditUsed', () => {
  const manual = { balanceIncludesCreditLimit: false };

  it('derives used from limit minus balance for an available-credit balance', () => {
    expect(computeCreditUsed({ ...manual, balance: 4000, creditLimit: 5000, balanceIsAvailableCredit: true })).toBe(
      1000,
    );
  });

  it('reads a positive debt-style balance as an overpayment with nothing drawn', () => {
    expect(
      computeCreditUsed({ ...manual, balance: 100, creditLimit: 10_000_000, balanceIsAvailableCredit: false }),
    ).toBe(0);
  });

  it('treats a negative debt-style balance as direct debt', () => {
    expect(computeCreditUsed({ ...manual, balance: -275, creditLimit: 150_000, balanceIsAvailableCredit: false })).toBe(
      275,
    );
  });

  it('treats a negative available-credit balance as direct debt', () => {
    expect(computeCreditUsed({ ...manual, balance: -300, creditLimit: 1000, balanceIsAvailableCredit: true })).toBe(
      300,
    );
  });

  it('reads a zero debt-style balance as an untouched card', () => {
    expect(computeCreditUsed({ ...manual, balance: 0, creditLimit: 150_000, balanceIsAvailableCredit: false })).toBe(0);
  });

  it('reads a zero available-credit balance as a fully drawn card', () => {
    expect(computeCreditUsed({ ...manual, balance: 0, creditLimit: 5000, balanceIsAvailableCredit: true })).toBe(5000);
  });

  it('clamps to zero when own money sits on top of the limit', () => {
    expect(computeCreditUsed({ ...manual, balance: 6000, creditLimit: 5000, balanceIsAvailableCredit: true })).toBe(0);
  });

  it('reads a zero balance as fully drawn when the balance embeds the credit limit', () => {
    expect(
      computeCreditUsed({
        balance: 0,
        creditLimit: 1000,
        balanceIncludesCreditLimit: true,
        balanceIsAvailableCredit: false,
      }),
    ).toBe(1000);
  });
});

describe('computeAccountDisplayBalances', () => {
  const account = { currentBalance: 200, refCurrentBalance: 400, creditLimit: 500, refCreditLimit: 1000 };

  it('returns the raw balances when the credit-limit setting is off', () => {
    expect(computeAccountDisplayBalances({ ...account, includeCreditLimit: false })).toEqual({
      hasCreditLimitAdjustment: false,
      displayBalance: 200,
      displayRefBalance: 400,
    });
  });

  it('does not adjust an account without a credit limit even when the setting is on', () => {
    expect(
      computeAccountDisplayBalances({ ...account, creditLimit: 0, refCreditLimit: 0, includeCreditLimit: true }),
    ).toEqual({ hasCreditLimitAdjustment: false, displayBalance: 200, displayRefBalance: 400 });
  });

  it('subtracts the native limit from the native balance and the ref limit from the ref balance', () => {
    expect(computeAccountDisplayBalances({ ...account, includeCreditLimit: true })).toEqual({
      hasCreditLimitAdjustment: true,
      displayBalance: -300,
      displayRefBalance: -600,
    });
  });

  it('shows Plaid credit debt without subtracting the limit twice', () => {
    expect(
      computeAccountDisplayBalances({
        currentBalance: 968.5,
        refCurrentBalance: 968.5,
        creditLimit: 1000,
        refCreditLimit: 1000,
        includeCreditLimit: true,
      }),
    ).toMatchObject({ displayBalance: -31.5, displayRefBalance: -31.5 });
  });

  it('shows a fully drawn card (zero native balance) as minus the limit in both currencies', () => {
    expect(
      computeAccountDisplayBalances({ ...account, currentBalance: 0, refCurrentBalance: 0, includeCreditLimit: true }),
    ).toEqual({ hasCreditLimitAdjustment: true, displayBalance: -500, displayRefBalance: -1000 });
  });
});
const passthrough = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) });
const tooltip = defineComponent({ props: ['content'], setup: (props, { slots }) => () => h('div', { 'data-content': props.content }, slots.default?.()) });

const render = ({ type, balance, includeCreditLimit }: { type: ACCOUNT_TYPES; balance: number; includeCreditLimit: boolean }) => {
  state.includeCreditLimit = includeCreditLimit;
  state.accounts = [{
    id: 'card', name: 'Card', type, status: ACCOUNT_STATUSES.active, excludeFromStats: false,
    currentBalance: balance, refCurrentBalance: balance, creditLimit: 30000, refCreditLimit: 30000, currencyCode: 'USD',
  }];
  return mount(CreditUtilizationWidget, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { WidgetWrapper: passthrough, ScrollArea: passthrough, DesktopOnlyTooltip: tooltip, ResponsiveTooltip: passthrough, AccountLogo: true, RouterLink: passthrough },
    },
  });
};

describe('credit utilization', () => {
  beforeEach(() => { state.accounts = []; state.includeCreditLimit = false; });

  it.each([false, true])('shows Plaid raw debt with the credit limit setting %s', (includeCreditLimit) => {
    const wrapper = render({ type: ACCOUNT_TYPES.plaid, balance: -3174.77, includeCreditLimit });
    expect(wrapper.text()).toContain('11%');
    expect(wrapper.text()).toContain('$3174.77');
    expect(wrapper.text()).toContain('$30000');
    expect(wrapper.find('[data-content="$3174.77 / $30000"]').exists()).toBe(true);
  });

  it.each([0, 100])('treats Plaid balance %s as untouched or overpaid even with the setting enabled', (balance) => {
    const wrapper = render({ type: ACCOUNT_TYPES.plaid, balance, includeCreditLimit: true });
    expect(wrapper.text()).toContain('0%');
    expect(wrapper.find('[data-content="$0 / $30000"]').exists()).toBe(true);
  });

  it('keeps other provider credit-limit-inclusive balances unchanged', () => {
    const wrapper = render({ type: ACCOUNT_TYPES.akahu, balance: 25000, includeCreditLimit: false });
    expect(wrapper.text()).toContain('17%');
    expect(wrapper.find('[data-content="$5000 / $30000"]').exists()).toBe(true);
  });
});
