import { BANK_PROVIDER_TYPE, type AccountModel } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: vi.fn(), addErrorNotification: vi.fn() }),
}));
vi.mock('@/stores', () => ({ useAccountsStore: () => ({ loadAccounts: vi.fn() }) }));
vi.mock('@/composable/formatters', () => ({
  useFormatCurrency: () => ({
    formatAmountByCurrencyCode: ({ amount }: { amount: number }) => String(amount),
    formatAccountAmount: ({ amount }: { amount: number }) => String(amount),
  }),
}));
vi.mock('vue-i18n', async (original) => ({
  ...(await original<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('@tanstack/vue-query', async (original) => {
  let calls = 0;
  return {
    ...(await original<typeof import('@tanstack/vue-query')>()),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({
      data: ref(
        calls++ === 0
          ? [{ id: 'connection', providerName: 'Plaid', providerType: BANK_PROVIDER_TYPE.PLAID }]
          : [{ externalId: 'credit', name: 'Card', currency: 'USD', balance: -31.5, creditLimit: 1000 }],
      ),
      isLoading: ref(false),
    }),
  };
});
vi.mock('@/components/common/responsive-dialog.vue', () => ({
  default: defineComponent({
    setup(_, { slots }) {
      return () => h('div', [slots.trigger?.(), slots.default?.()]);
    },
  }),
}));
vi.mock('@/components/lib/ui/select', () => {
  let count = 0;
  const Select = defineComponent({
    emits: ['update:modelValue'],
    setup(_, { emit, slots }) {
      const choice = count++ === 0 ? 'connection' : 'credit';
      return () =>
        h('div', [
          h('button', { 'data-choice': choice, onClick: () => emit('update:modelValue', choice) }, choice),
          slots.default?.(),
        ]);
    },
  });
  const passthrough = defineComponent({
    setup(_, { slots }) {
      return () => h('div', slots.default?.());
    },
  });
  return {
    __v_isRef: false,
    Select,
    SelectTrigger: passthrough,
    SelectValue: passthrough,
    SelectContent: passthrough,
    SelectItem: passthrough,
  };
});

import AccountLinkSection from './account-link-section.vue';

it('shows the Plaid credit card debt in the actual link preview', async () => {
  const account = {
    id: 'local',
    type: 'system',
    currentBalance: -31.5,
    creditLimit: 1000,
    currencyCode: 'USD',
  } as unknown as AccountModel;
  const wrapper = mount(AccountLinkSection, {
    props: { account },
    global: { mocks: { $t: (key: string) => key }, stubs: { BankConnectionLogo: true } },
  });
  await wrapper.get('[data-choice="connection"]').trigger('click');
  await wrapper.get('[data-choice="credit"]').trigger('click');
  const label = wrapper.findAll('p').find((element) => element.text() === 'pages.account.link.externalAccount');
  expect(label?.element.nextElementSibling?.textContent?.trim()).toBe('-31.5');
  const systemLabel = wrapper.findAll('p').find((element) => element.text() === 'pages.account.link.systemAccount');
  expect(systemLabel?.element.nextElementSibling?.textContent?.trim()).toBe('-31.5');
  const difference = wrapper.findAll('p').find((element) => element.text() === 'pages.account.link.difference');
  expect(difference?.element.nextElementSibling?.textContent?.trim()).toBe('0');
  expect(wrapper.text()).not.toContain('pages.account.link.residualTitle');
});
