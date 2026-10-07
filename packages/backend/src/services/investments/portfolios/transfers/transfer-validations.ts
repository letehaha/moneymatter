import { ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import Currencies from '@models/currencies.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { updatePortfolioBalance } from '@services/investments/portfolios/balances';
import { Big } from 'big.js';
import { format } from 'date-fns';

export function validatePositiveAmount({ amount }: { amount: string }): void {
  if (new Big(amount).lte(0)) {
    throw new ValidationError({ message: t({ key: 'investments.transferAmountMustBePositive' }) });
  }
}

export async function findPortfolioOrThrow({
  portfolioId,
  userId,
  role,
}: {
  portfolioId: string;
  userId: number;
  role: 'source' | 'destination' | 'generic';
}): Promise<Portfolios> {
  const messageKeyMap = {
    source: 'investments.sourcePortfolioNotFound',
    destination: 'investments.destinationPortfolioNotFound',
    generic: 'investments.portfolioNotFound',
  } as const;

  return findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
    message: t({ key: messageKeyMap[role] }),
  });
}

export async function findAccountOrThrow({
  accountId,
  userId,
  role,
}: {
  accountId: string;
  userId: number;
  role: 'source' | 'destination';
}): Promise<NonNullable<Awaited<ReturnType<typeof Accounts.getAccountById>>>> {
  const messageKey = role === 'source' ? 'investments.sourceAccountNotFound' : 'investments.destinationAccountNotFound';

  return findOrThrowNotFound({
    query: Accounts.getAccountById({ userId, id: accountId }),
    message: t({ key: messageKey }),
  });
}

/** A cash transfer writes a real row on the account, which a bank-linked account takes only from its sync. */
export function assertAccountNotBankLinked({ account }: { account: { type: ACCOUNT_TYPES } }): void {
  if (account.type !== ACCOUNT_TYPES.system) {
    throw new ValidationError({ message: t({ key: 'transactions.manualOnConnectedAccount' }) });
  }
}

export async function findCurrencyOrThrow({ currencyCode }: { currencyCode: string }): Promise<Currencies> {
  return findOrThrowNotFound({
    query: Currencies.findByPk(currencyCode),
    message: t({ key: 'investments.currencyNotFound' }),
  });
}

export function negateAmount({ amount }: { amount: string }): string {
  return new Big(amount).times(-1).toFixed(10);
}

export async function reverseTransferBalanceChanges({
  transfer,
  userId,
}: {
  transfer: PortfolioTransfers;
  userId: number;
}): Promise<void> {
  if (!transfer.affectsCash) return;

  const amount = transfer.amount.toDecimalString(10);
  const { currencyCode } = transfer;

  // Currency exchange: reverse both currency balance changes
  if (transfer.toCurrencyCode && transfer.toAmount && transfer.fromPortfolioId) {
    const toAmount = transfer.toAmount.toDecimalString(10);

    // Add back the from-amount to the source currency
    await updatePortfolioBalance({
      userId,
      portfolioId: transfer.fromPortfolioId,
      currencyCode,
      availableCashDelta: amount,
      totalCashDelta: amount,
    });

    // Subtract the to-amount from the target currency
    const negatedToAmount = negateAmount({ amount: toAmount });
    await updatePortfolioBalance({
      userId,
      portfolioId: transfer.fromPortfolioId,
      currencyCode: transfer.toCurrencyCode,
      availableCashDelta: negatedToAmount,
      totalCashDelta: negatedToAmount,
    });

    return;
  }

  // Regular transfer reversal
  if (transfer.fromPortfolioId) {
    await updatePortfolioBalance({
      userId,
      portfolioId: transfer.fromPortfolioId,
      currencyCode,
      availableCashDelta: amount,
      totalCashDelta: amount,
    });
  }

  if (transfer.toPortfolioId) {
    const negated = negateAmount({ amount });
    await updatePortfolioBalance({
      userId,
      portfolioId: transfer.toPortfolioId,
      currencyCode,
      availableCashDelta: negated,
      totalCashDelta: negated,
    });
  }
}

export async function getUserBaseCurrencyCode({ userId }: { userId: number }): Promise<string> {
  // `getCurrency` claims non-null but `findOne` can actually return `null` (incomplete onboarding).
  // Mirror calculate-ref-amount: throw a typed ValidationError instead of crashing on destructure.
  const result = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });
  if (!result) {
    throw new ValidationError({ message: t({ key: 'currencies.cannotFindForRefAmount' }) });
  }
  return result.currency.code;
}

export async function computeRefAmount({
  amount,
  currencyCode,
  userId,
  date,
  baseCurrencyCode,
}: {
  amount: string;
  currencyCode: string;
  userId: number;
  date: string;
  /** If known, skips the internal default-currency lookup. */
  baseCurrencyCode?: string;
}): Promise<Money> {
  return calculateRefAmount({
    amount: Money.fromDecimal(amount),
    baseCode: currencyCode,
    quoteCode: baseCurrencyCode,
    userId,
    date: new Date(date),
  });
}

/**
 * For a Transaction being promoted to (or re-stamped as) `transfer_to_portfolio`, derive the ref
 * fields the model validator requires. Computes `refAmount` from the tx's own currency/time so the
 * historical FX rate is used, and stamps the user's *current* base currency in `refCurrencyCode`.
 * Both must be set together — the validator rejects partial stamps.
 */
export async function computeRestampForExistingTransaction({
  tx,
  userId,
}: {
  tx: Transactions;
  userId: number;
}): Promise<{ refCurrencyCode: string; refAmount: Money }> {
  const refCurrencyCode = await getUserBaseCurrencyCode({ userId });
  const refAmount = await computeRefAmount({
    amount: tx.amount.toDecimalString(10),
    currencyCode: tx.currencyCode,
    userId,
    date: format(tx.time, 'yyyy-MM-dd'),
    baseCurrencyCode: refCurrencyCode,
  });
  return { refCurrencyCode, refAmount };
}
