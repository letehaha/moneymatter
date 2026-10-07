import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import {
  isTwoLegTransfer,
  ACCOUNT_TYPES,
  AccountModel,
  CategoryModel,
  CurrencyModel,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
} from '@bt/shared/types';

import type { TransferDestinationType } from './composables/transfer-form';
import { FORM_TYPES, type FormSplit, UI_FORM_STRUCT } from './types';

export const getDestinationAccount = ({
  isRecordExternal,
  sourceTransaction,
  account,
  toAccount,
}: {
  isRecordExternal: boolean;
  sourceTransaction: TransactionModel;
  account: AccountModel;
  toAccount: AccountModel;
}) => {
  if (isRecordExternal) {
    const isIncome = sourceTransaction.transactionType === TRANSACTION_TYPES.income;
    return isIncome ? account : toAccount;
  }
  return toAccount;
};

export const getDestinationAmount = ({
  fromAmount,
  toAmount,
  isCurrenciesDifferent,
  isRecordExternal,
  sourceTransaction,
}: {
  fromAmount: number;
  toAmount: number;
  isCurrenciesDifferent: boolean;
  isRecordExternal: boolean;
  sourceTransaction: TransactionModel;
}) => {
  if (isRecordExternal) {
    const isIncome = sourceTransaction.transactionType === TRANSACTION_TYPES.income;
    return isIncome ? fromAmount : toAmount;
  }
  return isCurrenciesDifferent ? toAmount : fromAmount;
};

export const getFormTypeFromTransaction = (tx: TransactionModel): FORM_TYPES => {
  if (isTwoLegTransfer(tx.transferNature) || tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) {
    return FORM_TYPES.transfer;
  }

  return tx.transactionType === TRANSACTION_TYPES.expense ? FORM_TYPES.expense : FORM_TYPES.income;
};

export const getTxTypeFromFormType = (formType: FORM_TYPES): TRANSACTION_TYPES => {
  // When user creates a brand-new "transfer" transaction, it's always should be
  // considered as "expense"
  if (formType === FORM_TYPES.transfer) return TRANSACTION_TYPES.expense;

  return formType === FORM_TYPES.expense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;
};

/**
 * A refund and the transaction it refunds always sit on opposite sides — an
 * expense is refunded by income and vice versa. The backend enforces this pairing,
 * so this mirrors it client-side: given a transaction type, return the type its
 * refund counterpart must have.
 */
export const getOppositeTxType = (type: TRANSACTION_TYPES): TRANSACTION_TYPES =>
  type === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;

export const isOutOfWalletAccount = (account: typeof OUT_OF_WALLET_ACCOUNT_MOCK) => account._isOutOfWallet;

// Real rows on a bank-connected account come from the sync, so the Create form makes them plans.
export const isConnectedAccount = ({ account }: { account: Pick<AccountModel, 'type'> }): boolean =>
  !!account.type && account.type !== ACCOUNT_TYPES.system;

/**
 * Transfer destinations for a given base transaction type. A loan payment is an
 * outflow (backend rejects transfer_to_loan on an income base), so income can
 * only target account/portfolio, never a loan.
 */
export const getAvailableTransferDestinationTypes = (transactionType: TRANSACTION_TYPES): TransferDestinationType[] => {
  const types: TransferDestinationType[] = ['account', 'portfolio'];
  if (transactionType !== TRANSACTION_TYPES.income) {
    types.push('loan');
  }
  return types;
};

// A planned row is user-entered data the bank hasn't confirmed yet, so amount and date
// stay editable even on a provider-linked account.
export const isTxEditableAsManual = ({
  transaction,
  isRecordExternal,
}: {
  transaction: TransactionModel | undefined | null;
  isRecordExternal: boolean;
}): boolean => !isRecordExternal || !!transaction?.isPlanned;

// Transfers can't be planned, so a flag left over from a type switch must never reach
// the payload.
export const resolveFormIsPlanned = ({ form }: { form: UI_FORM_STRUCT }): boolean =>
  form.type !== FORM_TYPES.transfer && !!form.isPlanned;

type OriginalCurrencyPairResolution =
  | { state: 'untouched' }
  | { state: 'clear' }
  | { state: 'pair'; originalAmount: number; originalCurrencyCode: string };

/**
 * What the form says the original-amount pair should become. A half-filled form resolves to
 * `untouched`, never `clear`: a currency the store has not resolved yet must not wipe the
 * stored amount.
 */
export const resolveOriginalCurrencyPair = ({ form }: { form: UI_FORM_STRUCT }): OriginalCurrencyPairResolution => {
  const originalAmount = form.originalAmount ?? null;
  const originalCurrencyCode = form.originalCurrency?.code ?? null;

  if (originalAmount !== null && originalCurrencyCode !== null) {
    return { state: 'pair', originalAmount, originalCurrencyCode };
  }
  if (originalAmount === null && originalCurrencyCode === null) return { state: 'clear' };
  return { state: 'untouched' };
};

// The backend cascades a transfer delete across both legs, so an external-bank
// partner (which can't be removed) would orphan the call — hide the button instead.
export const canDeleteTransaction = ({
  transaction,
  oppositeTransaction,
  accounts,
  canMutate,
}: {
  transaction: TransactionModel | undefined | null;
  oppositeTransaction: TransactionModel | undefined | null;
  accounts: Record<string, AccountModel>;
  canMutate: boolean;
}): boolean => {
  if (!transaction || !canMutate) return false;
  // A planned row is never a transfer leg and stays `accountType: system` until it
  // merges, so the backend deletes it whatever account it sits on.
  if (transaction.isPlanned) return true;
  const primaryAccount = accounts[transaction.accountId];
  if (!primaryAccount || primaryAccount.type !== ACCOUNT_TYPES.system) return false;
  if (oppositeTransaction) {
    const oppositeAccount = accounts[oppositeTransaction.accountId];
    if (!oppositeAccount || oppositeAccount.type !== ACCOUNT_TYPES.system) return false;
  }
  return true;
};

/**
 * Builds a flat map of category id -> FormattedCategory from the nested structure
 */
export const buildFormattedCategoriesMap = (
  categories: FormattedCategory[],
  map: Record<string, FormattedCategory> = {},
): Record<string, FormattedCategory> => {
  for (const category of categories) {
    map[category.id] = category;
    if (category.subCategories?.length > 0) {
      buildFormattedCategoriesMap(category.subCategories, map);
    }
  }
  return map;
};

export const prepopulateForm = ({
  transaction,
  oppositeTransaction,
  categories,
  accounts,
  formattedCategories,
  systemCurrencies,
}: {
  transaction: TransactionModel | undefined;
  oppositeTransaction: TransactionModel | undefined;
  categories: Record<string, CategoryModel>;
  accounts: Record<string, AccountModel>;
  formattedCategories: FormattedCategory[];
  /** Resolves `originalCurrencyCode` to the picker's option. Loads async, so it can be empty. */
  systemCurrencies: CurrencyModel[];
}) => {
  if (transaction) {
    // Build a flat map from formattedCategories for split conversion
    const formattedCategoriesMap = buildFormattedCategoriesMap(formattedCategories);

    // Transfers are created without a category (see `prepare-tx-creation-params.ts`), so the
    // source/opposite rows persist with `categoryId === null`. When the user later toggles a
    // transfer back to a regular expense/income, the form needs *some* selected category or
    // `prepareTxUpdationParams` would dereference a null. Fall back to the first available
    // formatted category so the picker starts with a sensible default — same shape any
    // freshly-created expense begins with.
    const resolvedCategory =
      formattedCategoriesMap[transaction.categoryId] ??
      categories[transaction.categoryId] ??
      formattedCategories[0] ??
      null;

    const initialFormValues = {
      type: getFormTypeFromTransaction(transaction),
      category: resolvedCategory,
      time: new Date(transaction.time),
      paymentType: VERBOSE_PAYMENT_TYPES.find((item) => item.value === transaction.paymentType),
      note: transaction.note ?? undefined,
      externalUrl: transaction.externalUrl ?? undefined,
      externalReference: transaction.externalReference ?? undefined,
      latitude: transaction.location?.latitude,
      longitude: transaction.location?.longitude,
      refundedByTxs: undefined,
      refundsTx: undefined,
      // Extract tag IDs from transaction tags if present
      tagIds: transaction.tags?.map((tag) => tag.id as string) ?? [],
      payeeId: transaction.payeeId ?? null,
      // Existing tx has a categoryId already, so treat the picker as user-touched
      // to prevent later Payee selections from silently overwriting it.
      categoryUserTouched: transaction.categoryId !== null && transaction.categoryId !== undefined,
      isPlanned: Boolean(transaction.isPlanned),
      originalAmount: transaction.originalAmount ?? null,
      originalCurrency: transaction.originalCurrencyCode
        ? (systemCurrencies.find((item) => item.code === transaction.originalCurrencyCode) ?? null)
        : null,
    } as UI_FORM_STRUCT;

    // Convert transaction splits to form splits
    if (transaction.splits && transaction.splits.length > 0) {
      initialFormValues.splits = transaction.splits.map(
        (split): FormSplit => ({
          id: split.id,
          category: formattedCategoriesMap[split.categoryId] ?? null,
          amount: split.amount,
          note: split.note,
        }),
      );
    }

    if (transaction.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) {
      if (transaction.transactionType === TRANSACTION_TYPES.income) {
        initialFormValues.account = OUT_OF_WALLET_ACCOUNT_MOCK;
        initialFormValues.targetAmount = transaction.amount;
        initialFormValues.toAccount = accounts[transaction.accountId]!;
      } else if (transaction.transactionType === TRANSACTION_TYPES.expense) {
        initialFormValues.amount = transaction.amount;
        initialFormValues.account = accounts[transaction.accountId]!;
        initialFormValues.toAccount = OUT_OF_WALLET_ACCOUNT_MOCK;
      }
    } else {
      // The form maps "amount/account" to the source (expense) side and
      // "targetAmount/toAccount" to the destination (income) side. When the primary
      // `transaction` is the income side (typical for external income transfers),
      // the source is the opposite transaction — flip the assignment accordingly so
      // the form-data layout doesn't depend on which side the caller treats as primary.
      const isTxIncome = transaction.transactionType === TRANSACTION_TYPES.income;
      const sourceTx = isTxIncome && oppositeTransaction ? oppositeTransaction : transaction;

      initialFormValues.amount = sourceTx.amount;
      initialFormValues.account = accounts[sourceTx.accountId]!;

      if (oppositeTransaction) {
        const destinationTx = isTxIncome ? transaction : oppositeTransaction;
        initialFormValues.toAccount = accounts[destinationTx.accountId]!;
        initialFormValues.targetAmount = destinationTx.amount;
      }
    }
    return initialFormValues;
  }
  return undefined;
};
