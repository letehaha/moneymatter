import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Transactions from '@models/transactions.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';

/**
 * Shared helpers for linking an existing Transaction to a tracked entity
 * (portfolio or venture event). The same primitives apply to both:
 *
 *   1. Snapshot the tx state we'll need to restore on unlink.
 *   2. Validate the tx isn't already attached to a different tracked entity.
 *   3. For txs being re-stamped, recompute the ref-amount at the tx's date
 *      so historical FX is preserved.
 *
 * Keeping this in one module prevents the portfolio + venture link paths
 * from drifting.
 */

/**
 * Exact set of fields captured on link and restored on unlink. Stored on
 * the link row's `metaData.originalTransactionState`.
 *
 * `amount` and `refAmount` are kept as decimals (the unit the money columns
 * store). Unlinking a venture event restores `refAmount`; the portfolio path
 * only records them.
 */
export interface OriginalTransactionStateSnapshot {
  transferNature: TRANSACTION_TRANSFER_NATURE;
  transferId: string | null;
  categoryId: string | null;
  amount: number;
  /** `null` when the transaction had no base-currency amount (a custom currency without a rate). */
  refAmount: number | null;
  accountId: string;
  transactionType: string;
  paymentType: string;
  currencyCode: string;
  refCurrencyCode: string;
  time: Date;
  note: string | null;
}

export function snapshotOriginalTransactionState(tx: Transactions): OriginalTransactionStateSnapshot {
  return {
    transferNature: tx.transferNature,
    transferId: tx.transferId,
    categoryId: tx.categoryId,
    amount: tx.amount.toNumber(),
    refAmount: tx.refAmount?.toNumber() ?? null,
    accountId: tx.accountId,
    transactionType: tx.transactionType,
    paymentType: tx.paymentType,
    currencyCode: tx.currencyCode,
    refCurrencyCode: tx.refCurrencyCode,
    time: tx.time,
    note: tx.note,
  };
}

/**
 * Transfer natures that already mark a tx as attached to a tracked entity.
 * A tx already in this state cannot be linked to a different tracked entity
 * without being unlinked first. Mirrors the BE audit list maintained when
 * `transfer_to_venture` was introduced.
 */
const ALREADY_TRACKED_NATURES: readonly TRANSACTION_TRANSFER_NATURE[] = [
  TRANSACTION_TRANSFER_NATURE.common_transfer,
  TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
  TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
];

/**
 * Throws if a transaction is already attached to a portfolio or venture
 * event. The caller may pass `allowNature` to whitelist a specific
 * transferNature for re-link flows (e.g., relinking an already-portfolio
 * transfer is allowed when the caller is the portfolio service itself).
 *
 * NOTE: This validates both the transferNature flag AND the actual link
 * row existence. A tx in flag-only inconsistent state (nature set but no
 * link row) is treated as linked — drift is rare and re-linking is safe.
 */
export async function assertNotAlreadyLinked({
  tx,
  allowNature,
}: {
  tx: Transactions;
  allowNature?: TRANSACTION_TRANSFER_NATURE;
}): Promise<void> {
  if (ALREADY_TRACKED_NATURES.includes(tx.transferNature) && tx.transferNature !== allowNature) {
    if (tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio) {
      throw new ValidationError({ message: t({ key: 'investments.transactionAlreadyLinkedToPortfolio' }) });
    }
    if (tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture) {
      throw new ValidationError({ message: t({ key: 'investments.transactionAlreadyLinkedToVenture' }) });
    }
    throw new ValidationError({ message: t({ key: 'investments.transactionAlreadyTransfer' }) });
  }

  // Catch flag/link-row drift: if the row exists in either tracking table
  // regardless of nature flag, refuse the new link to avoid duplicate
  // attachments.
  const [portfolioLink, ventureLink] = await Promise.all([
    PortfolioTransfers.findOne({ where: { transactionId: tx.id }, attributes: ['id'] }),
    VentureEventLinks.findOne({ where: { transactionId: tx.id }, attributes: ['id'] }),
  ]);

  if (portfolioLink && allowNature !== TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio) {
    throw new ValidationError({ message: t({ key: 'investments.transactionAlreadyLinkedToPortfolio' }) });
  }

  if (ventureLink && allowNature !== TRANSACTION_TRANSFER_NATURE.transfer_to_venture) {
    throw new ValidationError({ message: t({ key: 'investments.transactionAlreadyLinkedToVenture' }) });
  }
}

/**
 * Resolves the user's current base currency code. Throws when the user
 * hasn't completed onboarding (no default UsersCurrencies row).
 */
export async function getUserBaseCurrencyCode({ userId }: { userId: number }): Promise<string> {
  const result = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });
  if (!result) {
    throw new ValidationError({ message: t({ key: 'currencies.cannotFindForRefAmount' }) });
  }
  return result.currency.code;
}

/**
 * Recomputes ref-currency stamps for an existing transaction at the tx's
 * own date (so historical FX is preserved when relinking older txs).
 */
export async function restampForExistingTransaction({
  tx,
  userId,
}: {
  tx: Transactions;
  userId: number;
}): Promise<{ refCurrencyCode: string; refAmount: Money }> {
  const refCurrencyCode = await getUserBaseCurrencyCode({ userId });
  const refAmount = await calculateRefAmount({
    amount: Money.fromDecimal(tx.amount.toDecimalString(10)),
    baseCode: tx.currencyCode,
    quoteCode: refCurrencyCode,
    userId,
    date: tx.time,
  });
  return { refCurrencyCode, refAmount };
}
