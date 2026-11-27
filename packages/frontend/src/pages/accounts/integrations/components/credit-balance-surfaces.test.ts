import type * as Pinia from 'pinia';
import type * as VueI18n from 'vue-i18n';
import { ACCOUNT_TYPES, BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

vi.mock('@/composable', () => ({
  useFormatCurrency: () => ({ formatAmountByCurrencyCode: ({ amount }: { amount: number }) => String(amount) }),
}));
vi.mock('@/js/helpers', () => ({ toLocalCurrencyNumber: (amount: number) => String(amount) }));
vi.mock('@/stores', () => ({ useAccountsStore: () => ({}) }));
vi.mock('pinia', async (original) => ({
  ...(await original<typeof Pinia>()),
  storeToRefs: () => ({ accountsRecord: ref({}) }),
}));
vi.mock('vue-i18n', async (original) => ({
  ...(await original<typeof VueI18n>()),
  useI18n: () => ({ t: (key: string) => key }),
}));

import AccountSelectionRow from './account-selection-row.vue';
import ConnectAccountsDialog from './connect-accounts-dialog.vue';
import ConnectionAccountsTable from './connection-accounts-table.vue';

const passthrough = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.({ open: true })) });
const global = {
  mocks: { $t: (key: string) => key },
  stubs: {
    ResponsiveDialog: passthrough,
    Collapsible: passthrough,
    CollapsibleContent: passthrough,
    CollapsibleTrigger: passthrough,
    AccountVisualChip: true,
    IntegrationCurrencySelect: true,
    Checkbox: true,
    RouterLink: true,
    AccountLogo: true,
    ClickToCopy: true,
    DesktopOnlyTooltip: true,
    Popover: passthrough,
    PopoverTrigger: passthrough,
    PopoverContent: passthrough,
  },
};

const accounts = [
  { externalId: 'credit', name: 'Credit card', type: 'credit', balance: -31.5, creditLimit: 1000, currency: 'USD' },
  { externalId: 'checking', name: 'Checking', type: 'checking', balance: 75, creditLimit: 0, currency: 'USD' },
  { externalId: 'zero-limit', name: 'Zero-limit card', type: 'credit', balance: -42, creditLimit: 0, currency: 'USD' },
];

describe('integration account balances', () => {
  it('shows debt and unadjusted zero-limit balances in initial selection rows', () => {
    for (const [account, expected] of [[accounts[0]!, '-31.5'], [accounts[1]!, '75'], [accounts[2]!, '-42']] as const) {
      const wrapper = mount(AccountSelectionRow, { props: { account, providerType: BANK_PROVIDER_TYPE.PLAID, selected: false }, global });
      expect(wrapper.text()).toContain(expected);
      if (account.externalId === 'credit') expect(wrapper.text()).not.toContain('-1031.5');
    }
  });

  it('shows debt and unadjusted zero-limit balances for already connected accounts', () => {
    const wrapper = mount(ConnectAccountsDialog, {
      props: {
        open: true, accounts, isLoading: false, errorType: null,
        connectedExternalIds: new Set(['credit', 'checking', 'zero-limit']), providerName: 'Plaid',
        providerType: BANK_PROVIDER_TYPE.PLAID, isConnecting: false,
      },
      global,
    });
    expect(wrapper.text()).toContain('-31.5');
    expect(wrapper.text()).toContain('75');
    expect(wrapper.text()).toContain('-42');
    expect(wrapper.text()).not.toContain('-1031.5');
  });

  it('shows debt and unadjusted zero-limit balances in the connection accounts table without a hydrated store', () => {
    const rows = accounts.map((account) => ({
      id: account.externalId, name: account.name, externalId: account.externalId,
      currentBalance: account.balance, creditLimit: account.creditLimit,
      currencyCode: account.currency, type: ACCOUNT_TYPES.plaid, currencyFallback: null,
    }));
    const wrapper = mount(ConnectionAccountsTable, { props: { accounts: rows }, global });
    expect(wrapper.text()).toContain('-31.5');
    expect(wrapper.text()).toContain('75');
    expect(wrapper.text()).toContain('-42');
    expect(wrapper.text()).not.toContain('-1031.5');
  });

  it('preserves Akahu credit balances on every surface', () => {
    const akahu = { externalId: 'akahu-credit', name: 'Akahu credit', type: 'credit', balance: -120.5, creditLimit: 500, currency: 'USD' };
    const selection = mount(AccountSelectionRow, {
      props: { account: akahu, providerType: BANK_PROVIDER_TYPE.AKAHU, selected: false }, global,
    });
    const dialog = mount(ConnectAccountsDialog, {
      props: {
        open: true, accounts: [akahu], isLoading: false, errorType: null,
        connectedExternalIds: new Set([akahu.externalId]), providerName: 'Akahu',
        providerType: BANK_PROVIDER_TYPE.AKAHU, isConnecting: false,
      },
      global,
    });
    const table = mount(ConnectionAccountsTable, {
      props: { accounts: [{ id: 'akahu', name: akahu.name, externalId: akahu.externalId,
        currentBalance: akahu.balance, creditLimit: akahu.creditLimit,
        currencyCode: akahu.currency, type: ACCOUNT_TYPES.akahu, currencyFallback: null }] },
      global,
    });
    for (const wrapper of [selection, dialog, table]) {
      expect(wrapper.text()).toContain('-120.5');
      expect(wrapper.text()).not.toContain('-620.5');
    }
  });

  it('shows a Plaid balance when an older response omits the credit limit', () => {
    const table = mount(ConnectionAccountsTable, {
      props: { accounts: [{
        id: 'legacy', name: 'Legacy', externalId: 'legacy', currentBalance: 45,
        creditLimit: undefined as unknown as number, currencyCode: 'USD',
        type: ACCOUNT_TYPES.plaid, currencyFallback: null,
      }] },
      global,
    });
    expect(table.text()).toContain('45');
    expect(table.text()).not.toContain('NaN');
  });
});
