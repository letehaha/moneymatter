import dialogsEn from '@/i18n/locales/chunks/en/dialogs.json';
import { ACCOUNT_TYPES, AccountModel } from '@bt/shared/types';
import { buildSystemExpenseTransaction, buildSystemIncomeTransaction } from '@tests/mocks';
import { getUahAccount } from '@tests/mocks/accounts';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import { getFormTypeFromTransaction } from '../helpers';
import { FORM_TYPES } from '../types';
import TypeSelectorVue from './type-selector.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: dialogsEn },
});

describe('Record TypeSelector component', () => {
  describe('editing form', () => {
    test.each([
      [
        {
          ...buildSystemExpenseTransaction(),
          accountType: ACCOUNT_TYPES.monobank,
        },
        'Income',
      ],
      [
        {
          ...buildSystemIncomeTransaction(),
          accountType: ACCOUNT_TYPES.monobank,
        },
        'Expense',
      ],
    ])('correct buttons disabled when editing external transaction', (transaction, disabledBtnLabel) => {
      const wrapper = mount(TypeSelectorVue, {
        props: {
          selectedTransactionType: getFormTypeFromTransaction(transaction),
          transaction,
          account: getUahAccount({ type: ACCOUNT_TYPES.monobank }) as AccountModel,
        },
        global: {
          plugins: [i18n],
        },
      });

      const disabledButtons = wrapper.findAll('button').filter((item) => item.attributes().disabled !== undefined);

      expect(disabledButtons.map((item) => item.text())).toEqual([disabledBtnLabel]);
    });

    test.each([[buildSystemExpenseTransaction()], [buildSystemIncomeTransaction()]])(
      'nothing is disabled when editing system transaction',
      (transaction) => {
        const wrapper = mount(TypeSelectorVue, {
          props: {
            selectedTransactionType: getFormTypeFromTransaction(transaction),
            transaction,
            account: getUahAccount() as AccountModel,
          },
          global: {
            plugins: [i18n],
          },
        });

        const buttons = wrapper.findAll('button');
        const disabledButtons = buttons.filter((item) => item.attributes().disabled !== undefined);

        expect(disabledButtons.length).toBe(0);
      },
    );
  });

  test('only "Transfer" is disabled when isTransferDisabled is set', () => {
    const transaction = buildSystemExpenseTransaction();
    const wrapper = mount(TypeSelectorVue, {
      props: {
        selectedTransactionType: getFormTypeFromTransaction(transaction),
        isTransferDisabled: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const buttons = wrapper.findAll('button');
    const disabledButtons = buttons.filter((item) => item.attributes().disabled !== undefined);

    expect(disabledButtons.length).toBe(1);
    expect(disabledButtons[0]!.text()).toBe('Transfer');
  });

  const mountSelector = (props: Record<string, unknown>) =>
    mount(TypeSelectorVue, {
      props: { selectedTransactionType: FORM_TYPES.expense, ...props },
      global: { plugins: [i18n] },
    });
  const disabledLabels = (wrapper: ReturnType<typeof mountSelector>) =>
    wrapper
      .findAll('button')
      .filter((item) => item.attributes().disabled !== undefined)
      .map((item) => item.text());

  test('a locked type leaves only the selected button enabled', () => {
    expect(disabledLabels(mountSelector({ isTypeLocked: true }))).toEqual(['Income', 'Transfer']);
  });

  test('`disabled` disables every button', () => {
    expect(disabledLabels(mountSelector({ disabled: true }))).toEqual(['Expense', 'Income', 'Transfer']);
  });

  test('clicking a type emits it, and a disabled type emits nothing', async () => {
    const wrapper = mountSelector({ isTransferDisabled: true });

    await wrapper.find('button[aria-label="Select income"]').trigger('click');
    await wrapper.find('button[aria-label="Select transfer"]').trigger('click');

    expect(wrapper.emitted('change-tx-type')).toEqual([[FORM_TYPES.income]]);
  });
});
