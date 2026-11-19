import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';

import CreditLimitEditPopover from './credit-limit-edit-popover.vue';

vi.mock('@/stores', () => ({
  useAccountsStore: () => ({ editAccount: vi.fn() }),
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: vi.fn(), addErrorNotification: vi.fn() }),
}));

// Stand-in copy: the test checks which message is picked and what it is given, not the wording.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      forms: {
        validators: {
          invalidCurrencyDecimal: 'unused | {decimals} decimal | {decimals} decimals',
          invalidCurrencyWholeAmount: 'whole',
        },
      },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

// Renders the popover and tooltip slots inline, without Radix portals.
const passThrough = defineComponent({
  setup:
    (_props, { slots }) =>
    () =>
      h('div', {}, slots.default?.()),
});
const stubs = {
  Popover: passThrough,
  PopoverTrigger: passThrough,
  PopoverContent: passThrough,
  DesktopOnlyTooltip: passThrough,
};

const mountPopover = ({ creditLimit, currencyCode }: { creditLimit: number; currencyCode: string }) =>
  mount(CreditLimitEditPopover, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: { account: { id: 1, creditLimit, currencyCode } as any, currencyCode },
    global: { plugins: [i18n], stubs },
  });

const blurAmount = async ({ wrapper }: { wrapper: ReturnType<typeof mountPopover> }) => {
  await wrapper.find('input[type="number"]').trigger('blur');
  await flushPromises();
};

describe('CreditLimitEditPopover', () => {
  it('flags a stored value with more decimals than the currency stores', async () => {
    const wrapper = mountPopover({ creditLimit: 1.234, currencyCode: 'USD' });

    await blurAmount({ wrapper });

    expect(wrapper.text()).toContain('2 decimals');
  });

  it('uses the whole-number form for a 0-decimal currency', async () => {
    const wrapper = mountPopover({ creditLimit: 1500.5, currencyCode: 'JPY' });

    await blurAmount({ wrapper });

    expect(wrapper.text()).toContain('whole');
  });

  it('accepts a stored value within the currency decimals', async () => {
    const wrapper = mountPopover({ creditLimit: 1.234, currencyCode: 'KWD' });

    await blurAmount({ wrapper });

    expect(wrapper.text()).not.toContain('decimal');
    expect(wrapper.text()).not.toContain('whole');
  });
});
