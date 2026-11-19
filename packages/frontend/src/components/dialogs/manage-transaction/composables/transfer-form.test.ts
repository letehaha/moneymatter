import { buildSystemTransferExpenseTransaction, buildSystemTransferOppositeTransaction } from '@tests/mocks';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';
import { useTransferFormLogic } from './transfer-form';

vi.mock('@/stores', async () => {
  const { defineStore } = await import('pinia');
  const { ref: vueRef } = await import('vue');
  return {
    useAccountsStore: defineStore('accounts', () => ({ txTargetableAccountsActiveFirst: vueRef([]) })),
    useCurrenciesStore: defineStore('currencies', () => ({ currenciesMap: vueRef({}) })),
  };
});

const setup = ({
  isRecordOnBankAccount = false,
  isOppositeOnBankAccount = false,
  isRecordBankLocked = false,
  isOppositeBankLocked = false,
  isRecordIncome = false,
  isTransferTx = true,
  isLinked = false,
}: {
  isRecordOnBankAccount?: boolean;
  isOppositeOnBankAccount?: boolean;
  isRecordBankLocked?: boolean;
  isOppositeBankLocked?: boolean;
  isRecordIncome?: boolean;
  isTransferTx?: boolean;
  isLinked?: boolean;
}) => {
  const expenseLeg = buildSystemTransferExpenseTransaction();
  const incomeLeg = buildSystemTransferOppositeTransaction({ transferId: expenseLeg.transferId });

  return useTransferFormLogic({
    form: ref({ type: isTransferTx ? FORM_TYPES.transfer : FORM_TYPES.expense } as UI_FORM_STRUCT),
    isTransferTx: ref(isTransferTx),
    isRecordBankLocked: ref(isRecordBankLocked),
    isOppositeBankLocked: ref(isOppositeBankLocked),
    isRecordOnBankAccount: ref(isRecordOnBankAccount),
    isOppositeOnBankAccount: ref(isOppositeOnBankAccount),
    transaction: isRecordIncome ? incomeLeg : expenseLeg,
    oppositeTransaction: isRecordIncome ? expenseLeg : incomeLeg,
    linkedTransaction: ref(isLinked ? incomeLeg : null),
    transferDestinationType: ref('account'),
  });
};

describe('useTransferFormLogic account fields', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps a pre-seam manual expense leg on its bank account but lets the destination change', () => {
    const { fromAccountFieldDisabled, toAccountFieldDisabled } = setup({
      isRecordOnBankAccount: true,
      isOppositeOnBankAccount: false,
    });

    expect(fromAccountFieldDisabled.value).toBe(true);
    expect(toAccountFieldDisabled.value).toBe(false);
  });

  it('locks the source when the opposite expense leg sits on a bank account', () => {
    const { fromAccountFieldDisabled, toAccountFieldDisabled } = setup({
      isRecordOnBankAccount: false,
      isOppositeOnBankAccount: true,
      isRecordIncome: true,
    });

    expect(fromAccountFieldDisabled.value).toBe(true);
    expect(toAccountFieldDisabled.value).toBe(false);
  });

  it('leaves both account fields open for a plain manual pair', () => {
    const { fromAccountFieldDisabled, toAccountFieldDisabled } = setup({
      isRecordOnBankAccount: false,
      isOppositeOnBankAccount: false,
    });

    expect(fromAccountFieldDisabled.value).toBe(false);
    expect(toAccountFieldDisabled.value).toBe(false);
  });
});

describe('useTransferFormLogic toAccountFieldDisabled', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('locks the destination when the income record sits on a bank account', () => {
    expect(setup({ isRecordOnBankAccount: true, isRecordIncome: true }).toAccountFieldDisabled.value).toBe(true);
  });

  it('locks the destination when the opposite income leg sits on a bank account', () => {
    expect(setup({ isOppositeOnBankAccount: true }).toAccountFieldDisabled.value).toBe(true);
  });

  it('locks the destination once a transaction is linked', () => {
    expect(setup({ isLinked: true }).toAccountFieldDisabled.value).toBe(true);
  });
});

describe('useTransferFormLogic isAmountFieldDisabled', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('locks the source amount when the opposite expense leg is bank-locked', () => {
    expect(
      setup({ isRecordBankLocked: true, isOppositeBankLocked: true, isRecordIncome: true }).isAmountFieldDisabled.value,
    ).toBe(true);
  });

  it('locks the amount of a bank-locked expense record', () => {
    expect(setup({ isRecordBankLocked: true }).isAmountFieldDisabled.value).toBe(true);
  });

  it('locks the amount of a bank-locked record outside a transfer', () => {
    expect(
      setup({ isRecordBankLocked: true, isRecordIncome: true, isTransferTx: false }).isAmountFieldDisabled.value,
    ).toBe(true);
  });

  it('leaves the source amount open on a bank-locked income record with a manual opposite leg', () => {
    expect(setup({ isRecordBankLocked: true, isRecordIncome: true }).isAmountFieldDisabled.value).toBe(false);
  });

  it('leaves the amount open on a plain manual pair', () => {
    expect(setup({}).isAmountFieldDisabled.value).toBe(false);
  });
});
