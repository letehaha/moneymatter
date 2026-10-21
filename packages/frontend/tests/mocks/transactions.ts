import {
  ACCOUNT_TYPES,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
  type RecordId,
} from '@bt/shared/types';
import { faker } from '@faker-js/faker';

import { getUah2Account, getUahAccount } from './accounts';
import { USER_CATEGORIES } from './categories';
import { USER_BASE_CURRENCY, USER_CURRENCIES } from './currencies';
import { USER } from './user';

const SHARED_TX_ACCOUNT = getUahAccount();
const buildCommonTxBody = (overrides: Partial<TransactionModel> = {}): TransactionModel => {
  const amount = faker.number.int({ min: 1000, max: 100000 });
  const currencyCode = SHARED_TX_ACCOUNT.currencyCode;
  const currency = USER_CURRENCIES.find((item) => item.currencyCode === currencyCode)!;
  const refAmount = amount * currency.exchangeRate;

  return {
    id: faker.string.uuid() as RecordId,
    amount,
    refAmount,
    note: '',
    time: new Date(),
    userId: USER.id,
    transactionType: TRANSACTION_TYPES.income,
    paymentType: PAYMENT_TYPES.creditCard,
    accountId: SHARED_TX_ACCOUNT.id!,
    categoryId: USER_CATEGORIES[0]!.id,
    currencyCode: currencyCode!,
    accountType: ACCOUNT_TYPES.system,
    refCurrencyCode: USER_BASE_CURRENCY.currency!.code,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    transferId: '' as RecordId,
    originalId: '',
    externalData: {} as object,
    commissionRate: 0,
    refCommissionRate: 0,
    cashbackAmount: 0,
    originalAmount: null,
    originalCurrencyCode: null,
    externalUrl: null,
    externalReference: null,
    location: null,
    refundLinked: false,
    refAmountMissing: false,
    isPlanned: false,
    creatorSnapshot: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

export const buildSystemIncomeTransaction = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  buildCommonTxBody({
    transactionType: TRANSACTION_TYPES.income,
    ...overrides,
  });

export const buildSystemExpenseTransaction = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  buildCommonTxBody({
    transactionType: TRANSACTION_TYPES.expense,
    ...overrides,
  });

export const buildSystemTransferExpenseTransaction = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  buildSystemExpenseTransaction({
    transferId: faker.string.uuid() as RecordId,
    transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
    ...overrides,
  });

export const buildSystemTransferOppositeTransaction = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  buildSystemTransferExpenseTransaction({
    transactionType: TRANSACTION_TYPES.income,
    accountId: getUah2Account().id,
    ...overrides,
  });
export const buildOutOfWalletTransaction = (): TransactionModel =>
  buildCommonTxBody({
    transactionType: TRANSACTION_TYPES.expense,
    transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
  });

export const buildExternalExpenseTransaction = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  buildSystemExpenseTransaction({
    accountType: ACCOUNT_TYPES.monobank,
    ...overrides,
  });

export const buildExternalIncomeTransaction = (overrides: Partial<TransactionModel> = {}): TransactionModel =>
  buildSystemIncomeTransaction({
    accountType: ACCOUNT_TYPES.monobank,
    ...overrides,
  });

export const buildExternalTransferTransaction = (type: TRANSACTION_TYPES): TransactionModel => ({
  ...buildSystemTransferExpenseTransaction(),
  transactionType: type,
  accountType: ACCOUNT_TYPES.monobank,
});

export const buildExtendedCommonTx = (data: Partial<TransactionModel> = {}): TransactionModel => ({
  ...buildCommonTxBody(),
  ...data,
});
