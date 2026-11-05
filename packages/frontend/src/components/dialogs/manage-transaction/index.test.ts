import * as apiMethods from '@/api';
import { OUT_OF_WALLET_ACCOUNT_MOCK } from '@/common/const';
import { router } from '@/routes';
import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { faker } from '@faker-js/faker';
import { createTestingPinia } from '@pinia/testing';
import { VueQueryPlugin } from '@tanstack/vue-query';
import * as dataMocks from '@tests/mocks';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import FormComponent from './index.vue';

const mountComponent = ({ props = {} } = {}) =>
  mount(FormComponent, {
    props,
    global: {
      plugins: [
        createTestingPinia({
          initialState: {
            user: { user: dataMocks.USER },
            currencies: {
              currencies: dataMocks.USER_CURRENCIES,
              systemCurrencies: dataMocks.SYSTEM_CURRENCIES,
              baseCurrency: dataMocks.USER_BASE_CURRENCY,
            },
            categories: {
              categories: dataMocks.USER_CATEGORIES,
            },
            accounts: {
              accountsRecord: dataMocks.ACCOUNTS.reduce(
                (acc: Record<string, (typeof dataMocks.ACCOUNTS)[number]>, curr) => {
                  acc[curr.id] = curr;
                  return acc;
                },
                {},
              ),
            },
          },
        }),
        VueQueryPlugin,
        router,
      ],
    },
  });

const amountFieldSelector = 'input[placeholder="Amount"]';
const targetAmountFieldSelector = 'input[placeholder="Target amount"]';
const fillAmountField = async (wrapper: ReturnType<typeof mountComponent>, amount: number) => {
  const amountField = wrapper.find<HTMLInputElement>(amountFieldSelector);
  await amountField.setValue(amount);
};

const fillTargetAlmountField = async (wrapper: ReturnType<typeof mountComponent>, amount: number) => {
  const amountField = wrapper.find<HTMLInputElement>('input[placeholder="Target amount"]');
  await amountField.setValue(amount);
};

const findSelectField = (wrapper: ReturnType<typeof mountComponent>, label: string) =>
  wrapper.findAll('[role="select"]').find((item) => item.html().includes(label));

const fillAccountField = async (wrapper: ReturnType<typeof mountComponent>, label: string, value: string) => {
  const desiredSelectField = await findSelectField(wrapper, label);

  const triggerButton = desiredSelectField!.find('button');
  await triggerButton.trigger('click');

  const desiredAccountBtn = wrapper.findAll('button[role="option"]').find((item) => item.text().includes(value));
  await desiredAccountBtn!.trigger('click');
};

const fillCategoryField = async (wrapper: ReturnType<typeof mountComponent>, categoryName: string) => {
  const categoryFieldTrigger = await findSelectField(wrapper, 'Category')!.find('button[aria-label="Select category"]');
  await categoryFieldTrigger.trigger('click');

  let desiredCategoryBtn = wrapper
    .findAll('[data-test="category-select-field"] [role="option"]')
    .find((item) => item.text().includes(categoryName));
  await desiredCategoryBtn!.trigger('click');

  // Since that's how category selector works, we need to select it one more time
  desiredCategoryBtn = wrapper
    .findAll('[data-test="category-select-field"] [role="option"]')
    .find((item) => item.text().includes(categoryName));
  await desiredCategoryBtn!.trigger('click');
};

const getTransactionsLinkingButton = (wrapper: ReturnType<typeof mountComponent>) =>
  wrapper.findAll('button').find((btn) => btn.text().includes('Link the other side'));

const getTransactionsUnlinkingButton = (wrapper: ReturnType<typeof mountComponent>) =>
  wrapper.findAll('button').find((btn) => btn.text().includes('Unlink transactions'));

const submitCreation = async (wrapper: ReturnType<typeof mountComponent>) => {
  const submitBtn = wrapper.find('[aria-label="Create transaction"]');
  await submitBtn.trigger('click');
};

const submitUpdation = async (wrapper: ReturnType<typeof mountComponent>) => {
  const submitBtn = wrapper.find('[aria-label="Edit transaction"]');
  await submitBtn.trigger('click');
};
const submitDeletion = async (wrapper: ReturnType<typeof mountComponent>) => {
  const submitBtn = await wrapper.find('[aria-label="Delete transaction"]');
  await submitBtn.trigger('click');
};

const incomeFormTypeSelector = 'button[aria-label="Select income"]';
const expenseFormTypeSelector = 'button[aria-label="Select expense"]';
const transferFormTypeSelector = 'button[aria-label="Select transfer"]';

const commonAccountFieldLabel = 'Account';
const fromAccountFieldLabel = 'From account';
const toAccountFieldLabel = 'To account';

// TODO: rewrite to playwright because it's impossible to support this form with unit tests. It will
// require too much effort to reflect any DOM changes which will be difficult to debug
describe.skip('transactions create/update/delete form', () => {
  beforeAll(() => {
    // jsdom doesn't implement this method so we're adding our own
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    vi.spyOn(apiMethods, 'loadAccounts').mockReturnValue(Promise.resolve(dataMocks.ACCOUNTS));
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('transaction creation', () => {
    let createTxSpy = vi.spyOn(apiMethods, 'createTransaction');

    beforeEach(() => {
      createTxSpy = vi.spyOn(apiMethods, 'createTransaction');
    });

    test.each([
      ['income transaction', incomeFormTypeSelector, TRANSACTION_TYPES.income],
      ['expense transaction', expenseFormTypeSelector, TRANSACTION_TYPES.expense],
    ])('%s', async (_, formTypeSelector, expected) => {
      const expectedValue = {
        amount: 10,
        account: dataMocks.ACCOUNTS[0],
        category: dataMocks.USER_CATEGORIES[0],
      };

      const wrapper = await mountComponent();

      await wrapper.find(formTypeSelector).trigger('click');

      await fillAmountField(wrapper, expectedValue.amount);
      await fillAccountField(wrapper, commonAccountFieldLabel, expectedValue.account!.name);
      await fillCategoryField(wrapper, expectedValue.category!.name);

      await submitCreation(wrapper);

      expect(createTxSpy).toHaveBeenCalledWith({
        amount: String(expectedValue.amount),
        note: null,
        time: expect.any(String),
        transactionType: expected,
        paymentType: expect.any(String),
        accountId: expectedValue.account!.id,
        categoryId: expectedValue.category!.id,
      });
    });

    test('basic transfer', async () => {
      const expectedValue = {
        amount: 10,
        targetAmount: 20,
        account: dataMocks.ACCOUNTS[0],
        targetAccount: dataMocks.ACCOUNTS[1],
        category: dataMocks.USER_CATEGORIES[0],
      };

      const wrapper = await mountComponent();

      await wrapper.find(transferFormTypeSelector).trigger('click');

      await fillAccountField(wrapper, fromAccountFieldLabel, expectedValue.account!.name);
      await fillAccountField(wrapper, toAccountFieldLabel, expectedValue.targetAccount!.name);

      await fillAmountField(wrapper, expectedValue.amount);
      await fillTargetAlmountField(wrapper, expectedValue.targetAmount);

      await submitCreation(wrapper);

      expect(createTxSpy).toHaveBeenCalledWith({
        amount: String(expectedValue.amount),
        destinationAmount: String(expectedValue.targetAmount),
        destinationAccountId: expectedValue.targetAccount!.id,
        note: null,
        time: expect.any(String),
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        paymentType: expect.any(String),
        accountId: expectedValue.account!.id,
      });
    });

    test('transfer out of wallet', async () => {
      const expectedValue = {
        amount: 10,
        targetAmount: 20,
        account: dataMocks.ACCOUNTS[0],
        targetAccount: OUT_OF_WALLET_ACCOUNT_MOCK,
        category: dataMocks.USER_CATEGORIES[0],
      };

      const wrapper = await mountComponent();

      await wrapper.find(transferFormTypeSelector).trigger('click');

      await fillAccountField(wrapper, fromAccountFieldLabel, expectedValue.account!.name);
      await fillAccountField(wrapper, toAccountFieldLabel, expectedValue.targetAccount.name);

      await fillAmountField(wrapper, expectedValue.amount);

      await submitCreation(wrapper);

      expect(wrapper.find('input[placeholder="Target amount"]').attributes().disabled).not.toBe(undefined);

      expect(createTxSpy).toHaveBeenCalledWith({
        amount: String(expectedValue.amount),
        note: null,
        time: expect.any(String),
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
        paymentType: expect.any(String),
        accountId: expectedValue.account!.id,
      });
    });
  });

  describe('transaction updation', () => {
    let editTxSpy = vi.spyOn(apiMethods, 'editTransaction');

    beforeEach(() => {
      editTxSpy = vi.spyOn(apiMethods, 'editTransaction');
    });

    test.each([
      ['expense -> income', dataMocks.buildSystemExpenseTransaction()],
      ['income -> expense', dataMocks.buildSystemIncomeTransaction()],
    ])('%s', async (descr, transaction) => {
      const wrapper = await mountComponent({ props: { transaction } });

      await wrapper.find(incomeFormTypeSelector).trigger('click');

      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        accountId: transaction.accountId,
        amount: transaction.amount,
        categoryId: transaction.categoryId,
        note: null,
        paymentType: transaction.paymentType,
        time: transaction.time.toISOString(),
        transactionType: TRANSACTION_TYPES.income,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        txId: transaction.id,
      });
    });

    test('income -> expense + change amount and category', async () => {
      const expectedValue = {
        amount: 20,
        category: dataMocks.USER_CATEGORIES[1],
      };
      const transaction = dataMocks.buildSystemIncomeTransaction({
        categoryId: dataMocks.USER_CATEGORIES[0]!.id,
      });
      const wrapper = await mountComponent({
        props: { transaction },
      });

      await wrapper.find(expenseFormTypeSelector).trigger('click');

      await fillAmountField(wrapper, expectedValue.amount);
      await fillCategoryField(wrapper, expectedValue.category!.name);

      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        accountId: transaction.accountId,
        amount: expectedValue.amount,
        categoryId: expectedValue.category!.id,
        note: null,
        paymentType: transaction.paymentType,
        time: transaction.time.toISOString(),
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        txId: transaction.id,
      });
    });

    test.each([
      [TRANSACTION_TYPES.expense, dataMocks.buildExternalExpenseTransaction()],
      [TRANSACTION_TYPES.income, dataMocks.buildExternalIncomeTransaction()],
    ])('external %s: modify fields', async (txType, mock) => {
      const expectedValue = {
        category: dataMocks.USER_CATEGORIES[1],
      };
      const wrapper = await mountComponent({
        props: {
          transaction: {
            ...mock,
            categoryId: dataMocks.USER_CATEGORIES[0]!.id,
          },
        },
      });

      const isExpense = txType === TRANSACTION_TYPES.expense;

      expect(
        await wrapper.find(isExpense ? expenseFormTypeSelector : incomeFormTypeSelector).attributes()['aria-selected'],
      ).not.toBe(undefined);
      expect(
        await wrapper.find(isExpense ? incomeFormTypeSelector : expenseFormTypeSelector).attributes().disabled,
      ).not.toBe(undefined);
      expect(await wrapper.find(amountFieldSelector).attributes().disabled).not.toBe(undefined);
      expect(await wrapper.find('input[type="datetime-local"]').attributes().disabled).not.toBe(undefined);

      expect(await findSelectField(wrapper, 'Account')!.attributes()['aria-disabled']).not.toBe(undefined);
      expect(await findSelectField(wrapper, 'Payment Type')!.attributes()['aria-disabled']).not.toBe(undefined);
      expect(await wrapper.find('textarea').attributes().disabled).toBe(undefined);

      await fillCategoryField(wrapper, expectedValue.category!.name);
      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        categoryId: expectedValue.category!.id,
        note: null,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        txId: mock.id,
        paymentType: expect.any(String),
      });
    });

    test.each([
      [TRANSACTION_TYPES.income, dataMocks.buildSystemIncomeTransaction()],
      // [TRANSACTION_TYPES.expense, dataMocks.buildSystemExpenseTransaction()],
    ])('%s -> transfer with same currency', async (txType, transaction) => {
      const expectedValue = {
        amount: 95,
        account: dataMocks.getUahAccount(),
        targetAccount: dataMocks.getUah2Account(),
        targetAmount: 120,
      };

      const wrapper = await mountComponent({ props: { transaction } });
      await wrapper.find(transferFormTypeSelector).trigger('click');

      // const initialValue = await wrapper.find<HTMLInputElement>(
      //   txType === TRANSACTION_TYPES.income ? amountFieldSelector : targetAmountFieldSelector,
      // ).element.value;
      // console.log("initialValue", initialValue);
      // expect(initialValue).toBe("");

      await wrapper.find(amountFieldSelector).setValue(expectedValue.amount);
      await fillAccountField(wrapper, fromAccountFieldLabel, expectedValue.account!.name!);

      // TODO: implement and check that for income amount field is disabled and
      // reflects target amount field, and vice verse for expense
      // We still emulate like we set another value, but with the same currency
      // form should send targetAmount same as amount
      await fillAccountField(wrapper, toAccountFieldLabel, expectedValue.targetAccount!.name!);
      await fillTargetAlmountField(wrapper, expectedValue.targetAmount);

      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        accountId: expectedValue.account.id,
        amount: expectedValue.amount,

        destinationAccountId: expectedValue.targetAccount.id,
        destinationAmount: expectedValue.amount,

        note: null,
        paymentType: transaction.paymentType,
        time: transaction.time.toISOString(),
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        txId: transaction.id,
      });
    });

    test.each([
      [TRANSACTION_TYPES.income, dataMocks.buildSystemIncomeTransaction()],
      [TRANSACTION_TYPES.expense, dataMocks.buildSystemExpenseTransaction()],
    ])('%s -> transfer with different currency', async (txType, transaction) => {
      const expectedValue = {
        amount: 95,
        account: dataMocks.getUahAccount(),
        targetAccount: dataMocks.getEurAccount(),
        targetAmount: 120,
      };
      const wrapper = await mountComponent({ props: { transaction } });

      await wrapper.find(transferFormTypeSelector).trigger('click');

      const initialValue = await wrapper.find<HTMLInputElement>(
        txType === TRANSACTION_TYPES.income ? amountFieldSelector : targetAmountFieldSelector,
      ).element.value;
      expect(initialValue).toBe('');

      await wrapper.find(amountFieldSelector).setValue(expectedValue.amount);
      await fillAccountField(wrapper, fromAccountFieldLabel, expectedValue.account!.name!);
      await fillTargetAlmountField(wrapper, expectedValue.targetAmount);
      await fillAccountField(wrapper, toAccountFieldLabel, expectedValue.targetAccount!.name!);

      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        accountId: expectedValue.account.id,
        amount: expectedValue.amount,

        destinationAccountId: expectedValue.targetAccount.id,
        destinationAmount: expectedValue.targetAmount,

        note: null,
        paymentType: transaction.paymentType,
        time: transaction.time.toISOString(),
        transactionType: TRANSACTION_TYPES.expense,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        txId: transaction.id,
      });
    });

    test.each([[TRANSACTION_TYPES.income], [TRANSACTION_TYPES.expense]])('transfer -> %s', async (txType) => {
      const expectedValue = {
        amount: -50,
        account: dataMocks.getEurAccount(),
      };
      const transaction = dataMocks.buildSystemTransferExpenseTransaction();
      const oppositeTransaction = dataMocks.buildSystemTransferOppositeTransaction();

      const wrapper = await mountComponent({
        props: { transaction, oppositeTransaction },
      });

      await wrapper
        .find(txType === TRANSACTION_TYPES.income ? incomeFormTypeSelector : expenseFormTypeSelector)
        .trigger('click');

      // Check then when changing to anoter txType, the correct account is set to field
      expect(await findSelectField(wrapper, commonAccountFieldLabel)!.find('button').attributes().title).toBe(
        dataMocks.ACCOUNTS.find((item) => item.id === transaction.accountId)!.name,
      );

      expect(await wrapper.find<HTMLInputElement>(amountFieldSelector).element.value).toBe(String(transaction.amount));

      await fillAmountField(wrapper, expectedValue.amount);
      await fillAccountField(wrapper, commonAccountFieldLabel, expectedValue.account!.name!);

      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        accountId: expectedValue.account.id,
        amount: expectedValue.amount,
        categoryId: transaction.categoryId,
        note: null,
        paymentType: transaction.paymentType,
        time: transaction.time.toISOString(),
        transactionType: txType,
        // txId should be exactly of non-opposite tx
        txId: transaction.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      });
    });

    test.each([[TRANSACTION_TYPES.expense], [TRANSACTION_TYPES.income]])('external %s -> transfer', async (txType) => {
      const expectedValue = {
        amount: 95,
        account: dataMocks.getEurAccount(),
      };
      const isExpense = txType === TRANSACTION_TYPES.expense;
      const transaction = isExpense
        ? dataMocks.buildExternalExpenseTransaction()
        : dataMocks.buildExternalIncomeTransaction();
      const wrapper = await mountComponent({ props: { transaction } });

      await wrapper.find(transferFormTypeSelector).trigger('click');

      const initialValue = await wrapper.find<HTMLInputElement>(
        isExpense ? targetAmountFieldSelector : amountFieldSelector,
      ).element.value;
      expect(initialValue).toBe('');

      // Check that correct fields are disabled
      expect(
        await findSelectField(wrapper, isExpense ? fromAccountFieldLabel : toAccountFieldLabel)!.attributes()[
          'aria-disabled'
        ],
      ).not.toBe(undefined);
      expect(
        await wrapper.find<HTMLInputElement>(isExpense ? amountFieldSelector : targetAmountFieldSelector).attributes()
          .disabled,
      ).not.toBe(undefined);
      expect(await wrapper.find('input[type="datetime-local"]').attributes().disabled).not.toBe(undefined);
      expect(await findSelectField(wrapper, 'Payment Type')!.attributes()['aria-disabled']).not.toBe(undefined);

      await wrapper
        .find<HTMLInputElement>(isExpense ? targetAmountFieldSelector : amountFieldSelector)
        .setValue(expectedValue.amount);

      await fillAccountField(
        wrapper,
        isExpense ? toAccountFieldLabel : fromAccountFieldLabel,
        expectedValue.account!.name!,
      );

      await submitUpdation(wrapper);

      expect(editTxSpy).toHaveBeenCalledWith({
        // no matter what initial txType transaction was, since we're creating a
        // new tx from external one, it will always be "destination"-one tx
        destinationAccountId: expectedValue.account.id,
        destinationAmount: expectedValue.amount,

        note: null,
        paymentType: expect.any(String),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        txId: transaction.id,
      });
    });

    test.each([[TRANSACTION_TYPES.expense], [TRANSACTION_TYPES.income]])(
      'external %s transfer -> non-transfer external tx',
      async (txType) => {
        const expectedValue = {
          category: dataMocks.USER_CATEGORIES[2],
        };
        const isExpense = txType === TRANSACTION_TYPES.expense;
        const transaction = dataMocks.buildExternalTransferTransaction(txType);
        const wrapper = await mountComponent({
          props: {
            transaction,
            oppositeTransaction: dataMocks.buildExtendedCommonTx({
              transferId: transaction.transferId,
              transferNature: transaction.transferNature,
              transactionType: isExpense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
            }),
          },
        });

        // Check that by just opened all the fields have correct values and
        // disability states
        expect(
          await wrapper.find(isExpense ? incomeFormTypeSelector : expenseFormTypeSelector).attributes().disabled,
        ).not.toBe(undefined);

        const initialValue = await wrapper.find<HTMLInputElement>(
          isExpense ? targetAmountFieldSelector : amountFieldSelector,
        ).element.value;
        expect(initialValue).not.toBe('');

        // Check that correct fields are disabled
        expect(
          await findSelectField(wrapper, isExpense ? fromAccountFieldLabel : toAccountFieldLabel)!.attributes()[
            'aria-disabled'
          ],
        ).not.toBe(undefined);
        expect(
          await wrapper.find<HTMLInputElement>(isExpense ? amountFieldSelector : targetAmountFieldSelector).attributes()
            .disabled,
        ).not.toBe(undefined);
        expect(await wrapper.find('input[type="datetime-local"]').attributes().disabled).not.toBe(undefined);
        expect(await findSelectField(wrapper, 'Payment Type')!.attributes()['aria-disabled']).not.toBe(undefined);

        // Switch from trasfer to desired type
        await wrapper.find(isExpense ? expenseFormTypeSelector : incomeFormTypeSelector).trigger('click');

        // After siwtching test that only correct fields exists and correct ones
        // are disabled
        expect(await wrapper.find(targetAmountFieldSelector).exists()).toBe(false);
        expect(await wrapper.find(amountFieldSelector).attributes().disabled).not.toBe(undefined);
        expect(await findSelectField(wrapper, 'Payment Type')!.attributes()['aria-disabled']).not.toBe(undefined);
        expect(await findSelectField(wrapper, commonAccountFieldLabel)!.attributes()['aria-disabled']).not.toBe(
          undefined,
        );
        expect(await wrapper.find('input[type="datetime-local"]').attributes().disabled).not.toBe(undefined);

        const categoryTrigger = await findSelectField(wrapper, 'Category')!.find(
          'button[aria-label="Select category"]',
        );

        expect(
          categoryTrigger
            .html()
            .includes(dataMocks.USER_CATEGORIES.find((item) => item.id === transaction.categoryId)!.name),
        ).toBe(true);

        await fillCategoryField(wrapper, expectedValue.category!.name);

        await submitUpdation(wrapper);

        expect(editTxSpy).toHaveBeenCalledWith({
          note: null,
          categoryId: expectedValue.category!.id,
          paymentType: expect.any(String),
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          txId: transaction.id,
        });
      },
    );
  });

  describe('transaction deletion', () => {
    let deleteTxSpy = vi.spyOn(apiMethods, 'deleteTransaction');

    beforeEach(() => {
      deleteTxSpy = vi.spyOn(apiMethods, 'deleteTransaction');
    });

    test.each([
      ['delete expense', dataMocks.buildSystemExpenseTransaction()],
      ['delete income', dataMocks.buildSystemIncomeTransaction()],
      ['delete transfer', dataMocks.buildSystemTransferExpenseTransaction()],
    ])('%s', async (descr, mock) => {
      const wrapper = await mountComponent({ props: { transaction: mock } });
      await submitDeletion(wrapper);
      expect(deleteTxSpy).toHaveBeenCalledWith(mock.id);
    });

    test.each([
      ['cannot delete external expense', dataMocks.buildExternalExpenseTransaction()],
      ['cannot delete external income', dataMocks.buildExternalIncomeTransaction()],
      [
        'cannot delete external expense transfer',
        dataMocks.buildExternalTransferTransaction(TRANSACTION_TYPES.expense),
      ],
      ['cannot delete external income transfer', dataMocks.buildExternalTransferTransaction(TRANSACTION_TYPES.income)],
    ])('%s', async (descr, mock) => {
      const wrapper = await mountComponent({ props: { transaction: mock } });
      expect(await wrapper.find('[aria-label="Delete transaction"]').exists()).toBe(false);
      expect(deleteTxSpy).not.toHaveBeenCalled();
    });
  });

  describe('transactions linking', () => {
    let linkTxSpy = vi.spyOn(apiMethods, 'linkTransactions');

    beforeEach(() => {
      linkTxSpy = vi.spyOn(apiMethods, 'linkTransactions');
    });

    test.each([[TRANSACTION_TYPES.expense], [TRANSACTION_TYPES.income]])(
      'link %s system transaction',
      async (txType) => {
        const transaction =
          txType === TRANSACTION_TYPES.expense
            ? dataMocks.buildSystemExpenseTransaction()
            : dataMocks.buildSystemIncomeTransaction();

        const oppositeTransaction =
          txType === TRANSACTION_TYPES.expense
            ? dataMocks.buildSystemIncomeTransaction({
                accountId: dataMocks.getUah2Account().id,
              })
            : dataMocks.buildSystemExpenseTransaction({
                accountId: dataMocks.getUah2Account().id,
              });

        const wrapper = await mountComponent({ props: { transaction } });

        await wrapper.find(transferFormTypeSelector).trigger('click');
        await getTransactionsLinkingButton(wrapper)!.trigger('click');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wrapper.vm as any).linkedTransaction = oppositeTransaction;

        await nextTick();

        const txRecordBtn = await wrapper
          .findAll('button')
          .find((btn) =>
            btn.html().includes(dataMocks.USER_CATEGORIES.find((c) => c.id === oppositeTransaction.categoryId)!.name),
          );

        expect(txRecordBtn!.exists()).toBe(true);

        const amountField = wrapper.find<HTMLInputElement>(amountFieldSelector);
        expect(amountField.element.value).toBe(String(transaction.amount));
        expect(amountField.attributes().disabled).not.toBe(undefined);

        expect(await findSelectField(wrapper, commonAccountFieldLabel)!.find('button').attributes().title).toBe(
          dataMocks.ACCOUNTS.find((item) => item.id === transaction.accountId)!.name,
        );

        await submitUpdation(wrapper);

        expect(linkTxSpy).toHaveBeenCalledWith({
          ids: [[transaction.id, oppositeTransaction.id]],
        });
      },
    );

    test.each([[TRANSACTION_TYPES.expense], [TRANSACTION_TYPES.income]])(
      'link %s external transaction with a system one',
      async (txType) => {
        const transaction =
          txType === TRANSACTION_TYPES.expense
            ? dataMocks.buildExternalExpenseTransaction()
            : dataMocks.buildExternalIncomeTransaction();

        const oppositeTransaction =
          txType === TRANSACTION_TYPES.expense
            ? dataMocks.buildSystemIncomeTransaction({
                accountId: dataMocks.getUah2Account().id,
              })
            : dataMocks.buildSystemExpenseTransaction({
                accountId: dataMocks.getUah2Account().id,
              });

        const wrapper = await mountComponent({ props: { transaction } });

        await wrapper.find(transferFormTypeSelector).trigger('click');
        await getTransactionsLinkingButton(wrapper)!.trigger('click');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wrapper.vm as any).linkedTransaction = oppositeTransaction;

        await nextTick();

        const txRecordBtn = await wrapper
          .findAll('button')
          .find((btn) =>
            btn.html().includes(dataMocks.USER_CATEGORIES.find((c) => c.id === oppositeTransaction.categoryId)!.name),
          );

        expect(txRecordBtn!.exists()).toBe(true);

        const amountField = wrapper.find<HTMLInputElement>(amountFieldSelector);
        expect(amountField.element.value).toBe(String(transaction.amount));
        expect(amountField.attributes().disabled).not.toBe(undefined);

        expect(await findSelectField(wrapper, commonAccountFieldLabel)!.find('button').attributes().title).toBe(
          dataMocks.ACCOUNTS.find((item) => item.id === transaction.accountId)!.name,
        );

        await submitUpdation(wrapper);

        expect(linkTxSpy).toHaveBeenCalledWith({
          ids: [[transaction.id, oppositeTransaction.id]],
        });
      },
    );

    test("form doesn't have unlinking option while still creating transfer tx", async () => {
      const wrapper = await mountComponent({
        props: {
          transaction: dataMocks.buildSystemExpenseTransaction(),
        },
      });

      await wrapper.find(transferFormTypeSelector).trigger('click');
      const unlinkButton = await getTransactionsUnlinkingButton(wrapper);
      expect(unlinkButton).toBe(undefined);
    });
  });

  describe('transactions unlinking', () => {
    let unlinkTxSpy = vi.spyOn(apiMethods, 'unlinkTransactions');
    const transaction = dataMocks.buildSystemExpenseTransaction();
    const oppositeTransaction = {
      ...dataMocks.buildSystemIncomeTransaction(),
      id: faker.string.uuid(),
      accountId: dataMocks.getUah2Account().id,
    };

    beforeEach(() => {
      unlinkTxSpy = vi.spyOn(apiMethods, 'unlinkTransactions');
    });

    test('unlink transaction', async () => {
      const wrapper = await mountComponent({
        props: { transaction, oppositeTransaction },
      });

      await wrapper.find(transferFormTypeSelector).trigger('click');
      await getTransactionsUnlinkingButton(wrapper)!.trigger('click');

      expect(unlinkTxSpy).toHaveBeenCalledWith({
        transferIds: [transaction.transferId],
      });
    });
    test("form doesn't have linking option when editing", async () => {
      const wrapper = await mountComponent({
        props: { transaction, oppositeTransaction },
      });

      const linkButton = await getTransactionsLinkingButton(wrapper);
      expect(linkButton).toBe(undefined);
    });
  });
});
