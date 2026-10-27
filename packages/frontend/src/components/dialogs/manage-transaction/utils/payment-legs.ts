import type {
  AccountModel,
  PaymentLegInput,
  RecordId,
  TransactionModel,
  TransactionPaymentPart,
} from '@bt/shared/types';

import type { FormPaymentLeg, UI_FORM_STRUCT } from '../types';

type ConvertFn = (params: { amount: number; from: string; to: string }) => number | null;

/** Default date window (± days around the main transaction) for the "Link existing transactions" picker. */
export const PAYMENT_LINK_WINDOW_DAYS = 3;

/** True only on a payment's main row: a leg row carries the parts too, but they are edited through the main. */
export const hasPaymentParts = ({ transaction }: { transaction: TransactionModel | null | undefined }): boolean =>
  !transaction?.paymentParentId && (transaction?.paymentParts?.length ?? 0) > 1;

/** Lists filtered by account show every part as its own row and send no total. */
export const isAccountScopedPaymentRow = ({ transaction }: { transaction: TransactionModel }): boolean =>
  transaction.paymentTotal === undefined;

/** A collapsed payment row stands for the whole payment. Parts are shared in the main's
 *  currency, so the main's own rate brings the total to the base currency. */
export const getPaymentRowAmounts = ({
  transaction,
}: {
  transaction: TransactionModel;
}): { amount: number; refAmount: number } => {
  const { amount, refAmount, paymentTotal } = transaction;
  if (paymentTotal === undefined || !amount) return { amount, refAmount };
  return { amount: paymentTotal, refAmount: (refAmount * paymentTotal) / amount };
};

export const getPaymentMainCurrencyCode = ({ transaction }: { transaction: TransactionModel }): string =>
  transaction.paymentParts?.find((part) => part.transactionId === (transaction.paymentParentId ?? transaction.id))
    ?.currencyCode ?? transaction.currencyCode;

export const paymentPartsToFormLegs = ({
  parts,
  mainTransactionId,
  accounts,
}: {
  parts: TransactionPaymentPart[];
  mainTransactionId: string;
  accounts: Record<string, AccountModel>;
}): FormPaymentLeg[] =>
  parts
    .filter((part) => part.transactionId !== mainTransactionId)
    .map((part) => ({
      transactionId: part.transactionId,
      account: accounts[part.accountId] ?? null,
      accountId: part.accountId,
      amount: part.amount,
      currencyCode: part.currencyCode,
      paymentAmount: part.paymentAmount,
      isLinked: part.isLinked,
      // A saved share is the user's figure; the market rate must not overwrite it.
      isPaymentAmountEdited: true,
    }));

export const isCrossCurrencyLeg = ({
  leg,
  mainCurrencyCode,
}: {
  leg: FormPaymentLeg;
  mainCurrencyCode: string | undefined;
}): boolean => Boolean(leg.currencyCode && mainCurrencyCode && leg.currencyCode !== mainCurrencyCode);

/** The leg's share in the main row's currency. */
const legShare = ({ leg, mainCurrencyCode }: { leg: FormPaymentLeg; mainCurrencyCode: string | undefined }) =>
  Number(isCrossCurrencyLeg({ leg, mainCurrencyCode }) ? leg.paymentAmount : leg.amount) || 0;

export const sumPaymentRows = ({
  mainAmount,
  legs,
  mainCurrencyCode,
}: {
  mainAmount: number | null;
  legs: FormPaymentLeg[];
  mainCurrencyCode: string | undefined;
}): number =>
  Math.round(legs.reduce((sum, leg) => sum + legShare({ leg, mainCurrencyCode }), Number(mainAmount) || 0) * 100) / 100;

/** The single-account amount once the legs are dropped: an unlinked row stays its own transaction, so it is left out. */
export const sumMainWithCreatedLegs = ({
  mainAmount,
  legs,
  mainCurrencyCode,
}: {
  mainAmount: number | null;
  legs: FormPaymentLeg[];
  mainCurrencyCode: string | undefined;
}): number => sumPaymentRows({ mainAmount, legs: legs.filter((leg) => !leg.isLinked), mainCurrencyCode });

/** Refills the main-currency share from the market rate until the user types one. */
export const refreshLegPaymentAmount = ({
  leg,
  mainCurrencyCode,
  convert,
}: {
  leg: FormPaymentLeg;
  mainCurrencyCode: string | undefined;
  convert: ConvertFn;
}): FormPaymentLeg => {
  if (leg.isPaymentAmountEdited || !isCrossCurrencyLeg({ leg, mainCurrencyCode })) return leg;
  const amount = Number(leg.amount);
  return {
    ...leg,
    paymentAmount: amount > 0 ? convert({ amount, from: leg.currencyCode!, to: mainCurrencyCode! }) : null,
  };
};

/** A user-set share follows the leg amount at the user's own rate; otherwise the market rate refills it. */
export const setPaymentLegAmount = ({
  leg,
  amount,
  mainCurrencyCode,
  convert,
}: {
  leg: FormPaymentLeg;
  amount: number | null;
  mainCurrencyCode: string | undefined;
  convert: ConvertFn;
}): FormPaymentLeg => {
  const oldAmount = Number(leg.amount);
  const share = Number(leg.paymentAmount);
  const newAmount = Number(amount);
  if (
    leg.isPaymentAmountEdited &&
    isCrossCurrencyLeg({ leg, mainCurrencyCode }) &&
    oldAmount > 0 &&
    share > 0 &&
    newAmount > 0
  ) {
    return { ...leg, amount, paymentAmount: Math.round(((share * newAmount) / oldAmount) * 100) / 100 };
  }
  return refreshLegPaymentAmount({ leg: { ...leg, amount, isPaymentAmountEdited: false }, mainCurrencyCode, convert });
};

export const getPaymentLegAccountId = ({ leg }: { leg: FormPaymentLeg }): RecordId | undefined =>
  leg.account?.id ?? leg.accountId;

const isPaymentLegAmountMissing = ({ leg }: { leg: FormPaymentLeg }): boolean => !(Number(leg.amount) > 0);

const isPaymentLegShareMissing = ({
  leg,
  mainCurrencyCode,
}: {
  leg: FormPaymentLeg;
  mainCurrencyCode: string | undefined;
}): boolean => isCrossCurrencyLeg({ leg, mainCurrencyCode }) && !(Number(leg.paymentAmount) > 0);

export const isPaymentLegIncomplete = ({
  leg,
  mainCurrencyCode,
}: {
  leg: FormPaymentLeg;
  mainCurrencyCode: string | undefined;
}): boolean =>
  (!leg.isLinked && (!getPaymentLegAccountId({ leg }) || isPaymentLegAmountMissing({ leg }))) ||
  isPaymentLegShareMissing({ leg, mainCurrencyCode });

const toPaymentLegInput = ({
  leg,
  mainCurrencyCode,
}: {
  leg: FormPaymentLeg;
  mainCurrencyCode: string | undefined;
}): PaymentLegInput => {
  const share = isCrossCurrencyLeg({ leg, mainCurrencyCode }) ? { paymentAmount: Number(leg.paymentAmount) } : {};
  if (leg.isLinked) return { transactionId: leg.transactionId!, ...share };
  if (leg.transactionId) return { transactionId: leg.transactionId, amount: Number(leg.amount), ...share };
  return { accountId: getPaymentLegAccountId({ leg })!, amount: Number(leg.amount), ...share };
};

export const formLegsToPaymentLegs = ({
  legs,
  mainCurrencyCode,
}: {
  legs: FormPaymentLeg[];
  mainCurrencyCode: string | undefined;
}): PaymentLegInput[] =>
  legs.map((leg) => {
    if (isPaymentLegIncomplete({ leg, mainCurrencyCode })) throw new Error('Incomplete payment leg reached submit');
    return toPaymentLegInput({ leg, mainCurrencyCode });
  });

/**
 * `undefined` keeps the saved legs (also when the form still matches them, so the backend skips
 * its account-ownership check), `null` turns the payment back into a single-account row.
 */
export const resolvePaymentLegsUpdate = ({
  form,
  transaction,
}: {
  form: Pick<UI_FORM_STRUCT, 'paymentLegs' | 'account'>;
  transaction: TransactionModel;
}): PaymentLegInput[] | null | undefined => {
  if (!form.paymentLegs?.length) return hasPaymentParts({ transaction }) ? null : undefined;

  const mainCurrencyCode = form.account?.currencyCode ?? transaction.currencyCode;
  const next = formLegsToPaymentLegs({ legs: form.paymentLegs, mainCurrencyCode });
  const saved = (transaction.paymentParts ?? []).filter((part) => part.transactionId !== transaction.id);
  // Every share is in the main currency, so a currency switch must resend them all.
  const isUnchanged =
    mainCurrencyCode === transaction.currencyCode &&
    next.length === saved.length &&
    next.every((leg, i) => {
      const part = saved[i]!;
      return (
        leg.transactionId === part.transactionId &&
        (leg.amount === undefined || leg.amount === part.amount) &&
        (leg.paymentAmount === undefined || leg.paymentAmount === part.paymentAmount)
      );
    });
  return isUnchanged ? undefined : next;
};
