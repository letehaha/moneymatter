import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES } from '@/common/const';
import {
  ACCOUNT_CATEGORIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  AccountModel,
  TransactionModel,
  type RecordId,
} from '@bt/shared/types';
import {
  SYSTEM_CURRENCIES,
  USER_CATEGORIES,
  buildExternalExpenseTransaction,
  buildOutOfWalletTransaction,
  buildSystemExpenseTransaction,
  buildSystemIncomeTransaction,
  buildSystemTransferExpenseTransaction,
  getUah2Account,
  getUahAccount,
} from '@tests/mocks';

import { FORM_TYPES, UI_FORM_STRUCT } from '../types';
import { prepareTxUpdationParams } from './prepare-tx-updation-params';

const buildBaseFormMock = (
  transaction: TransactionModel,
): Pick<
  UI_FORM_STRUCT,
  'time' | 'note' | 'paymentType' | 'refundedByTxs' | 'category' | 'refundsTx' | 'originalCurrency'
> => ({
  time: transaction.time,
  note: undefined,
  paymentType: VERBOSE_PAYMENT_TYPES.find((i) => i.value === transaction.paymentType) ?? null,
  refundedByTxs: undefined,
  category: undefined as unknown as UI_FORM_STRUCT['category'],
  refundsTx: undefined,
  originalCurrency: null,
});

describe('prepareTxUpdationParams', () => {
  let sourceAccount: ReturnType<typeof getUahAccount>;
  let destinationAccount: ReturnType<typeof getUahAccount>;
  let transactionMock: ReturnType<typeof buildOutOfWalletTransaction>;

  describe('out_of_wallet details edition', () => {
    beforeEach(() => {
      destinationAccount = getUahAccount();
      transactionMock = buildOutOfWalletTransaction();
    });

    it('handles "out_of_wallet -> account" updation', () => {
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(transactionMock),
        type: FORM_TYPES.transfer,
        account: OUT_OF_WALLET_ACCOUNT_MOCK,
        amount: null,
        targetAmount: 1000,
        toAccount: destinationAccount as AccountModel,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: transactionMock,
          linkedTransaction: null,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: true,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: transactionMock.id,
        amount: formMock.targetAmount,
        note: formMock.note,
        time: expect.anything(),
        // out_of_wallet -> account = income
        transactionType: TRANSACTION_TYPES.income,
        paymentType: transactionMock.paymentType,
        accountId: formMock.toAccount!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      });
    });
    it('handles "account -> out_of_wallet" updation', () => {
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(transactionMock),
        type: FORM_TYPES.transfer,
        account: destinationAccount as AccountModel,
        amount: 1000,
        targetAmount: null,
        toAccount: OUT_OF_WALLET_ACCOUNT_MOCK,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: transactionMock,
          linkedTransaction: null,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: true,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: transactionMock.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        // account -> out_of_wallet = expense
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: transactionMock.paymentType,
        accountId: formMock.account!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      });
    });
  });

  describe('common transfer', () => {
    it('handles same-currency amount updation', () => {
      sourceAccount = getUah2Account();
      destinationAccount = getUahAccount();
      transactionMock = buildSystemTransferExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(transactionMock),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2500,
        toAccount: destinationAccount as AccountModel,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: transactionMock,
          linkedTransaction: null,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: true,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: transactionMock.id,
        accountId: formMock.account!.id,
        amount: +formMock.amount!,

        destinationAccountId: formMock.toAccount!.id,
        destinationAmount: +formMock.targetAmount!,

        note: formMock.note,
        time: expect.anything(),
        // for common transfers it's always `expense` transaction as a source
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: transactionMock.paymentType,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
    });
  });

  describe('loan transfer nature handling', () => {
    beforeEach(() => {
      sourceAccount = getUahAccount();
    });

    it('keeps common_transfer on an existing pair even when the destination is a loan account', () => {
      const transferTx = buildSystemTransferExpenseTransaction();
      const loanAccount = getUah2Account({ accountCategory: ACCOUNT_CATEGORIES.loan });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(transferTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: loanAccount as AccountModel,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: transferTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(result.destinationAccountId).toBe(loanAccount.id);
    });

    it('keeps transfer_to_loan on an existing loan payment pair', () => {
      const loanPaymentTx = buildSystemTransferExpenseTransaction({
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      });
      const loanAccount = getUah2Account({ accountCategory: ACCOUNT_CATEGORIES.loan });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(loanPaymentTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: loanAccount as AccountModel,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: loanPaymentTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(result.destinationAccountId).toBe(loanAccount.id);
    });

    it('promotes a non-transfer transaction to transfer_to_loan when the destination is a loan account', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const loanAccount = getUah2Account({ accountCategory: ACCOUNT_CATEGORIES.loan });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: loanAccount as AccountModel,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
      expect(result.destinationAccountId).toBe(loanAccount.id);
      expect(result.destinationAmount).toBe(2000);
    });

    it('promotes a non-transfer transaction to common_transfer when the destination is not a loan account', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const regularAccount = getUah2Account();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: regularAccount as AccountModel,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    });
  });

  describe('external record handling', () => {
    it('handles external record updation', () => {
      const expenseTx = buildExternalExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.expense,
        account: null,
        amount: 1500,
        note: 'Updated external record',
        paymentType: VERBOSE_PAYMENT_TYPES.find((p) => p.value === 'cash') ?? null,
        category: USER_CATEGORIES[0]!,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: true,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: expenseTx.id,
        note: formMock.note,
        paymentType: formMock.paymentType!.value,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        categoryId: formMock.category!.id,
      });
    });

    it('handles external expense → transfer_out_wallet (account → out_of_wallet) conversion without transactionType', () => {
      const expenseTx = buildExternalExpenseTransaction();
      const destAccount = getUahAccount();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: destAccount as AccountModel,
        amount: 1500,
        targetAmount: null,
        toAccount: OUT_OF_WALLET_ACCOUNT_MOCK,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: true,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result).toEqual({
        txId: expenseTx.id,
        note: formMock.note,
        paymentType: formMock.paymentType!.value,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      });

      // Ensure transactionType is NOT set for external transactions (restricted field)
      expect(result).not.toHaveProperty('transactionType');
    });

    it('handles external expense → transfer_out_wallet (out_of_wallet → account) conversion without transactionType', () => {
      const expenseTx = buildExternalExpenseTransaction();
      const destAccount = getUahAccount();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: OUT_OF_WALLET_ACCOUNT_MOCK,
        amount: null,
        targetAmount: 1500,
        toAccount: destAccount as AccountModel,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: true,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result).toEqual({
        txId: expenseTx.id,
        note: formMock.note,
        paymentType: formMock.paymentType!.value,
        accountId: destinationAccount.id,
        amount: formMock.targetAmount,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      });

      // Ensure transactionType is NOT set for external transactions (restricted field)
      expect(result).not.toHaveProperty('transactionType');
    });
  });

  describe('planned rows', () => {
    beforeEach(() => {
      sourceAccount = getUahAccount();
    });

    it('keeps amount and date in the payload for a planned row on a synced account', () => {
      const plannedTx = buildExternalExpenseTransaction({ isPlanned: true });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(plannedTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        isPlanned: true,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: plannedTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: true,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result).toEqual({
        txId: plannedTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: plannedTx.paymentType,
        accountId: formMock.account!.id,
        categoryId: formMock.category!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      });
    });

    it('sends isPlanned: true when the flag is checked on an existing manual row', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        isPlanned: true,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result.isPlanned).toBe(true);
    });

    it('sends isPlanned: false when the flag is unchecked on a planned row', () => {
      const plannedTx = buildSystemExpenseTransaction({ isPlanned: true });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(plannedTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        isPlanned: false,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: plannedTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result.isPlanned).toBe(false);
    });

    it('omits isPlanned when an unrelated edit leaves the flag untouched', () => {
      const plannedTx = buildSystemExpenseTransaction({ isPlanned: true });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(plannedTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        note: 'Fixed a typo',
        category: USER_CATEGORIES[0]!,
        isPlanned: true,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: plannedTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result).not.toHaveProperty('isPlanned');
    });

    it('never sends isPlanned: true in a transfer payload', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: getUah2Account() as AccountModel,
        // Stale flag the reset watch would have cleared already.
        isPlanned: true,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: true,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result).not.toHaveProperty('isPlanned');
    });
  });

  describe('income/expense conversions', () => {
    beforeEach(() => {
      sourceAccount = getUahAccount();
      destinationAccount = getUah2Account();
    });

    it('handles "income -> expense" updation', () => {
      const incomeTx = buildSystemIncomeTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(incomeTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: incomeTx,
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: incomeTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: incomeTx.paymentType,
        accountId: formMock.account!.id,
        categoryId: formMock.category!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      });
    });

    it('handles "expense -> income" updation', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.income,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: expenseTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.income,
        paymentType: expenseTx.paymentType,
        accountId: formMock.account!.id,
        categoryId: formMock.category!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      });
    });
  });

  describe('transfer conversions', () => {
    beforeEach(() => {
      sourceAccount = getUahAccount();
      destinationAccount = getUah2Account();
    });

    it('handles "income -> common_transfer" updation', () => {
      const incomeTx = buildSystemIncomeTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(incomeTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: destinationAccount as AccountModel,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: incomeTx,
          linkedTransaction: null,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: incomeTx.id,
        accountId: formMock.account!.id,
        amount: +formMock.amount!,
        destinationAccountId: formMock.toAccount!.id,
        destinationAmount: +formMock.targetAmount!,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: incomeTx.paymentType,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
    });

    it('handles "expense -> transfer_out_wallet" updation', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 1500,
        targetAmount: null,
        toAccount: OUT_OF_WALLET_ACCOUNT_MOCK,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: null,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: expenseTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: expenseTx.paymentType,
        accountId: formMock.account!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      });
    });

    it('does not crash when converting common_transfer → expense with a null form.category', () => {
      // Pre-existing FE issue surfaced by the cross-user transfer flow: transfers are
      // persisted with `categoryId: null` and if the user toggles to expense before
      // picking a category, dereferencing `category.id` would throw a TypeError. The
      // dialog should still submit; the backend keeps the existing column.
      const transferTx = buildSystemTransferExpenseTransaction({
        categoryId: null as unknown as RecordId,
      });
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(transferTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        // category intentionally left as the buildBaseFormMock default (null).
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: transferTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

      expect(result).not.toHaveProperty('categoryId');
      expect(result).toMatchObject({
        txId: transferTx.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        transactionType: TRANSACTION_TYPES.expense,
        accountId: formMock.account!.id,
      });
    });

    it('handles "transfer_out_wallet -> expense" updation', () => {
      const outOfWalletTx = buildOutOfWalletTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(outOfWalletTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: outOfWalletTx,
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: outOfWalletTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: outOfWalletTx.paymentType,
        accountId: formMock.account!.id,
        categoryId: formMock.category!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      });
    });
  });

  describe('refund handling', () => {
    beforeEach(() => {
      sourceAccount = getUahAccount();
    });

    it('handles refundsTx addition', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const refundTx = buildSystemIncomeTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        refundsTx: [{ transaction: refundTx }],
        refundedByTxs: null,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: true,
        }),
      ).toEqual({
        txId: expenseTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: expenseTx.paymentType,
        accountId: formMock.account!.id,
        categoryId: formMock.category!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        refundsTargets: [{ txId: refundTx.id, splitId: null, amount: null }],
      });
    });

    it('handles refundedByTxs addition', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const refundingTxs = [buildSystemIncomeTransaction(), buildSystemIncomeTransaction()];
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        refundsTx: null,
        refundedByTxs: refundingTxs.map((tx, i) => ({ transaction: tx, splitId: i === 0 ? 'split-1' : undefined })),
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: true,
        }),
      ).toEqual({
        txId: expenseTx.id,
        amount: formMock.amount,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: expenseTx.paymentType,
        accountId: formMock.account!.id,
        categoryId: formMock.category!.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        refundedByTxIds: [{ txId: refundingTxs[0]!.id }, { txId: refundingTxs[1]!.id }],
      });
    });

    it('sends each refunded-by share, omitting the amount only when the server keeps it', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const [partial, whole, kept, dropped] = [
        buildSystemIncomeTransaction(),
        buildSystemIncomeTransaction(),
        buildSystemIncomeTransaction(),
        buildSystemIncomeTransaction(),
      ];
      const result = prepareTxUpdationParams({
        form: {
          ...buildBaseFormMock(expenseTx),
          type: FORM_TYPES.expense,
          account: sourceAccount as AccountModel,
          amount: 1500,
          category: USER_CATEGORIES[0]!,
          refundsTx: null,
          refundedByTxs: [
            { transaction: partial!, amount: 500 },
            { transaction: whole!, amount: null },
            { transaction: kept!, amount: undefined },
            { transaction: dropped!, amount: 0 },
          ],
        },
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: true,
      });

      expect(result.refundedByTxIds).toEqual([
        { txId: partial!.id, amount: 500 },
        { txId: whole!.id, amount: null },
        { txId: kept!.id },
      ]);
    });

    it('sends a full clear when both sides were cleared in one session', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const result = prepareTxUpdationParams({
        form: {
          ...buildBaseFormMock(expenseTx),
          type: FORM_TYPES.expense,
          account: sourceAccount as AccountModel,
          amount: 1500,
          category: USER_CATEGORIES[0]!,
          refundsTx: null,
          refundedByTxs: null,
        },
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: true,
      });

      expect(result.refundsTargets).toBeNull();
      expect(result).not.toHaveProperty('refundedByTxIds');
    });

    describe('refund targets payload', () => {
      const buildRefundForm = ({ refundsTx }: { refundsTx: UI_FORM_STRUCT['refundsTx'] }): UI_FORM_STRUCT => ({
        ...buildBaseFormMock(buildSystemExpenseTransaction()),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 100,
        category: USER_CATEGORIES[0]!,
        refundsTx,
        refundedByTxs: null,
      });

      const prepare = (form: UI_FORM_STRUCT) =>
        prepareTxUpdationParams({
          form,
          transaction: buildSystemExpenseTransaction(),
          linkedTransaction: null,
          isTransferTx: false,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: true,
        });

      it('sends a single whole-refund target with a null amount', () => {
        const original = buildSystemIncomeTransaction();
        const result = prepare(
          buildRefundForm({ refundsTx: [{ transaction: original, splitId: 'split-1', amount: null }] }),
        );

        expect(result.refundsTxId).toBeUndefined();
        expect(result.refundsTargets).toEqual([{ txId: original.id, splitId: 'split-1', amount: null }]);
      });

      it('clears the link with refundsTargets null', () => {
        const result = prepare({ ...buildRefundForm({ refundsTx: null }), refundedByTxs: undefined });

        expect(result.refundsTxId).toBeUndefined();
        expect(result.refundsTargets).toBeNull();
      });

      it('sends refundsTargets for a single partial share', () => {
        const original = buildSystemIncomeTransaction();
        const result = prepare(buildRefundForm({ refundsTx: [{ transaction: original, amount: 40 }] }));

        expect(result.refundsTxId).toBeUndefined();
        expect(result.refundsTargets).toEqual([{ txId: original.id, splitId: null, amount: 40 }]);
      });

      it('leaves out a target whose share dropped to zero', () => {
        const first = buildSystemIncomeTransaction();
        const second = buildSystemIncomeTransaction();
        const result = prepare(
          buildRefundForm({
            refundsTx: [
              { transaction: first, amount: 100, isAdjusted: false },
              { transaction: second, amount: 0, isAdjusted: false },
            ],
          }),
        );

        expect(result.refundsTargets).toEqual([{ txId: first.id, splitId: null, amount: 100 }]);
      });

      it('sends refundsTargets with every share for several targets', () => {
        const first = buildSystemIncomeTransaction();
        const second = buildSystemIncomeTransaction();
        const result = prepare(
          buildRefundForm({
            refundsTx: [
              { transaction: first, amount: 60 },
              { transaction: second, splitId: 'split-2', amount: 40 },
            ],
          }),
        );

        expect(result.refundsTxId).toBeUndefined();
        expect(result.refundsSplitId).toBeUndefined();
        expect(result.refundedByTxIds).toBeUndefined();
        expect(result.refundsTargets).toEqual([
          { txId: first.id, splitId: null, amount: 60 },
          { txId: second.id, splitId: 'split-2', amount: 40 },
        ]);
      });
    });

    // Defense-in-depth: a stale same-type link left over from a type toggle must never
    // be forwarded, since the backend rejects it with a 422.
    it('omits refundsTargets when the linked transaction has the same type as the form', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const sameTypeRefund = buildSystemExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        refundsTx: [{ transaction: sameTypeRefund }],
        refundedByTxs: null,
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: true,
      });

      expect(result.refundsTargets).toBeUndefined();
    });

    it('omits refundedByTxIds when a linked transaction has the same type as the form', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const sameTypeRefund = buildSystemExpenseTransaction();
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.expense,
        account: sourceAccount as AccountModel,
        amount: 1500,
        category: USER_CATEGORIES[0]!,
        refundsTx: null,
        refundedByTxs: [{ transaction: sameTypeRefund }],
      };

      const result = prepareTxUpdationParams({
        form: formMock,
        transaction: expenseTx,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: true,
      });

      expect(result.refundedByTxIds).toBeUndefined();
    });
  });

  describe('linked transactions', () => {
    beforeEach(() => {
      sourceAccount = getUahAccount();
      destinationAccount = getUah2Account();
    });

    it('handles common transfer with linked transaction', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const linkedTx = buildSystemIncomeTransaction(); // opposite txType
      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: destinationAccount as AccountModel,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: linkedTx,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: expenseTx.id,
        accountId: formMock.account!.id,
        amount: +formMock.amount!,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: expenseTx.paymentType,
        destinationTransactionId: linkedTx.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
    });

    it('throws error when linked transaction is not opposite to source one', () => {
      const expenseTx = buildSystemExpenseTransaction();
      const linkedTx = buildSystemExpenseTransaction();

      const formMock: UI_FORM_STRUCT = {
        ...buildBaseFormMock(expenseTx),
        type: FORM_TYPES.transfer,
        account: sourceAccount as AccountModel,
        amount: 2000,
        targetAmount: 2000,
        toAccount: destinationAccount as AccountModel,
      };

      expect(
        prepareTxUpdationParams({
          form: formMock,
          transaction: expenseTx,
          linkedTransaction: linkedTx,
          isTransferTx: true,
          isRecordExternal: false,
          isCurrenciesDifferent: false,
          isOriginalRefundsOverriden: false,
        }),
      ).toEqual({
        txId: expenseTx.id,
        accountId: formMock.account!.id,
        amount: +formMock.amount!,
        note: formMock.note,
        time: expect.anything(),
        transactionType: TRANSACTION_TYPES.expense,
        paymentType: expenseTx.paymentType,
        destinationTransactionId: linkedTx.id,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
    });
  });

  describe('original currency pair', () => {
    const JPY = SYSTEM_CURRENCIES.find((item) => item.code === 'JPY')!;

    const buildForm = ({
      transaction,
      ...overrides
    }: { transaction: TransactionModel } & Partial<UI_FORM_STRUCT>): UI_FORM_STRUCT => ({
      ...buildBaseFormMock(transaction),
      type: FORM_TYPES.expense,
      account: getUahAccount() as AccountModel,
      amount: transaction.amount,
      toAccount: null,
      targetAmount: null,
      ...overrides,
    });

    const update = ({ form, transaction }: { form: UI_FORM_STRUCT; transaction: TransactionModel }) =>
      prepareTxUpdationParams({
        form,
        transaction,
        linkedTransaction: null,
        isTransferTx: form.type === FORM_TYPES.transfer,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

    it('sends both fields when a pair is added', () => {
      const transaction = buildSystemExpenseTransaction();
      const form = buildForm({ transaction, originalAmount: 1500, originalCurrency: JPY });

      const result = update({ form, transaction });

      expect(result.originalAmount).toBe(1500);
      expect(result.originalCurrencyCode).toBe('JPY');
    });

    it('sends both fields as null when a stored pair is cleared', () => {
      const transaction = buildSystemExpenseTransaction({ originalAmount: 1500, originalCurrencyCode: 'JPY' });
      const form = buildForm({ transaction, originalAmount: null, originalCurrency: null });

      const result = update({ form, transaction });

      expect(result.originalAmount).toBeNull();
      expect(result.originalCurrencyCode).toBeNull();
    });

    it('omits both fields when the pair is untouched', () => {
      const transaction = buildSystemExpenseTransaction({ originalAmount: 1500, originalCurrencyCode: 'JPY' });
      const form = buildForm({ transaction, originalAmount: 1500, originalCurrency: JPY });

      const result = update({ form, transaction });

      expect(result).not.toHaveProperty('originalAmount');
      expect(result).not.toHaveProperty('originalCurrencyCode');
    });

    it('leaves a stored pair alone when the form pair is half-filled', () => {
      const transaction = buildSystemExpenseTransaction({ originalAmount: 1500, originalCurrencyCode: 'JPY' });
      const form = buildForm({ transaction, originalAmount: 2000, originalCurrency: null });

      const result = update({ form, transaction });

      expect(result).not.toHaveProperty('originalAmount');
      expect(result).not.toHaveProperty('originalCurrencyCode');
    });

    it('never sends the pair in a transfer payload', () => {
      const transaction = buildSystemExpenseTransaction();
      const form = buildForm({
        transaction,
        type: FORM_TYPES.transfer,
        toAccount: getUah2Account() as AccountModel,
        targetAmount: transaction.amount,
        originalAmount: 1500,
        originalCurrency: JPY,
      });

      const result = update({ form, transaction });

      expect(result).not.toHaveProperty('originalAmount');
      expect(result).not.toHaveProperty('originalCurrencyCode');
    });
  });

  describe('external fields', () => {
    const update = ({ transaction, ...overrides }: { transaction: TransactionModel } & Partial<UI_FORM_STRUCT>) =>
      prepareTxUpdationParams({
        form: {
          ...buildBaseFormMock(transaction),
          type: FORM_TYPES.expense,
          account: getUahAccount() as AccountModel,
          amount: transaction.amount,
          toAccount: null,
          targetAmount: null,
          ...overrides,
        },
        transaction,
        linkedTransaction: null,
        isTransferTx: false,
        isRecordExternal: false,
        isCurrenciesDifferent: false,
        isOriginalRefundsOverriden: false,
      });

    it('omits both fields when the form leaves them undefined', () => {
      const result = update({ transaction: buildSystemExpenseTransaction() });

      expect(result).not.toHaveProperty('externalUrl');
      expect(result).not.toHaveProperty('externalReference');
    });

    it('sends null when a field holds only whitespace', () => {
      const result = update({
        transaction: buildSystemExpenseTransaction(),
        externalUrl: '',
        externalReference: '   ',
      });

      expect(result.externalUrl).toBeNull();
      expect(result.externalReference).toBeNull();
    });

    it('omits location when untouched, sends null when cleared, object when set', () => {
      const transaction = buildSystemExpenseTransaction();

      expect(update({ transaction })).not.toHaveProperty('location');
      expect(update({ transaction, latitude: null, longitude: null }).location).toBeNull();
      expect(update({ transaction, latitude: 50.45, longitude: 30.52 }).location).toEqual({
        latitude: 50.45,
        longitude: 30.52,
      });
    });

    it('trims the values it sends', () => {
      const result = update({
        transaction: buildSystemExpenseTransaction(),
        externalUrl: ' https://x.example/1 ',
        externalReference: ' REF-1 ',
      });

      expect(result.externalUrl).toBe('https://x.example/1');
      expect(result.externalReference).toBe('REF-1');
    });
  });
});
