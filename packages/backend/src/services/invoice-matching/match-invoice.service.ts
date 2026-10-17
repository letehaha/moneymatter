import {
  type ExtractedInvoice,
  FEATURES,
  type InvoiceMatchCandidate,
  type InvoiceMatchResult,
  TRANSACTION_TYPES,
  invoiceCounterpartyName,
} from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { trackInvoiceMatchRequested } from '@js/utils/posthog';
import Payees from '@models/payees.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { type TransactionApiResponse, serializeTransaction } from '@root/serializers/transactions.serializer';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.utils';
import { type FeatureAccess, recordFeatureUse } from '@services/entitlements/feature-trial.service';
import { FUZZY_MIN_MATCH_CHAR_LENGTH } from '@services/payees/fuzzy-matcher';
import { getTransactions } from '@services/transactions/get-transactions';
import { getExchangeRate } from '@services/user-exchange-rate';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { Op } from 'sequelize';

import { extractInvoice } from './extract-invoice.service';
import { resolveMerchantSimilarity } from './merchant-similarity';
import { AMOUNT_TOLERANCE, DAYS_AFTER_INVOICE, DAYS_BEFORE_INVOICE, scoreCandidates } from './score-candidates';

/** Scoring is cheap, but the payee lookup and the Jev call are not. */
const CANDIDATE_LIMIT = 50;

/** Null when the rate for that day is unknown, which downgrades the search to raw amounts. */
async function convertToBaseCurrency({
  userId,
  invoice,
}: {
  userId: number;
  invoice: ExtractedInvoice;
}): Promise<Money | null> {
  try {
    const base = await getBaseCurrency({ userId });
    // An invoice is often in a currency the user never connected, so the market rate must do.
    const { rate } = await getExchangeRate({
      userId,
      date: new Date(invoice.issueDate),
      baseCode: invoice.currencyCode,
      quoteCode: base.currency.code,
      requireUserConnection: false,
    });
    return calculateRefAmountFromParams({
      amount: Money.fromDecimal(invoice.totalAmount),
      rate,
      baseDecimals: await getCurrencyDecimals({ userId, code: invoice.currencyCode }),
      quoteDecimals: await getCurrencyDecimals({ userId, code: base.currency.code }),
    });
  } catch (error) {
    logger.warn('[Invoice Matching] Invoice currency could not be converted, matching on raw amounts', {
      userId,
      currencyCode: invoice.currencyCode,
      error,
    });
    return null;
  }
}

const toleranceRange = ({ amount }: { amount: Money }) => ({
  gte: amount.multiply(1 - AMOUNT_TOLERANCE),
  lte: amount.multiply(1 + AMOUNT_TOLERANCE),
});

async function payeeNamesById({ payeeIds }: { payeeIds: string[] }): Promise<Map<string, string>> {
  if (!payeeIds.length) return new Map();

  const payees = await Payees.findAll({ where: { id: { [Op.in]: payeeIds } }, attributes: ['id', 'name'] });
  return new Map(payees.map((payee) => [payee.id, payee.name]));
}

/**
 * Ranks the transactions that could be the payment for an already-extracted invoice.
 * Separate from extraction so a correction flow can re-rank without paying for the AI read.
 */
export async function findInvoiceCandidates({
  userId,
  invoice,
  allowJev,
}: {
  userId: number;
  invoice: ExtractedInvoice;
  /** Jev runs on the operator's TypeSafe budget, so only entitled callers may spend it. */
  allowJev: boolean;
}): Promise<{ candidates: InvoiceMatchCandidate<TransactionApiResponse>[]; usedJev: boolean }> {
  const issueDate = parseISO(invoice.issueDate);
  const baseAmount = await convertToBaseCurrency({ userId, invoice });
  const searchWindow = {
    userId,
    transactionType: invoice.transactionType,
    startDate: format(subDays(issueDate, DAYS_BEFORE_INVOICE), 'yyyy-MM-dd'),
    // A date-only bound parses as midnight, which would drop everything later on the last day.
    endDate: `${format(addDays(issueDate, DAYS_AFTER_INVOICE), 'yyyy-MM-dd')}T23:59:59.999Z`,
    excludeTransfer: true,
    includeHasAttachments: true,
    limit: CANDIDATE_LIMIT,
  };
  const rawRange = toleranceRange({ amount: Money.fromDecimal(invoice.totalAmount) });
  const baseRange = baseAmount ? toleranceRange({ amount: baseAmount }) : null;

  // Two queries: the base-currency window is the only one that spans currencies, but a
  // same-currency payment converted at its own day's rate can sit far outside it, and the
  // scorer would have compared it in the invoice's currency without converting anything.
  const [byRefAmount, byRawAmount] = await Promise.all([
    baseRange ? getTransactions({ ...searchWindow, refAmountGte: baseRange.gte, refAmountLte: baseRange.lte }) : [],
    getTransactions({ ...searchWindow, amountGte: rawRange.gte, amountLte: rawRange.lte }),
  ]);

  const sameCurrency = baseRange
    ? byRawAmount.filter(
        (tx) => tx.currencyCode === invoice.currencyCode || tx.originalCurrencyCode === invoice.currencyCode,
      )
    : byRawAmount;
  const transactions = [...new Map([...byRefAmount, ...sameCurrency].map((tx) => [tx.id, tx])).values()];

  if (!transactions.length) return { candidates: [], usedJev: false };

  const serialized = transactions.map((transaction) => serializeTransaction(transaction));
  const payeeNames = await payeeNamesById({
    payeeIds: [...new Set(serialized.map((tx) => tx.payeeId).filter((id): id is string => id !== null))],
  });

  const describe = ({ tx }: { tx: TransactionApiResponse }) =>
    [tx.note, tx.payeeId ? payeeNames.get(tx.payeeId) : null].filter(Boolean).join(' ');

  const counterpartyName = invoiceCounterpartyName({ invoice })?.trim() ?? '';
  // Below the fuzzy matcher's minimum every similarity comes back zero, which would read as
  // "no candidate matches" and penalise every transaction that has a payee.
  const merchantKnown = counterpartyName.length >= FUZZY_MIN_MATCH_CHAR_LENGTH;

  const { similarityById, usedJev } = merchantKnown
    ? await resolveMerchantSimilarity({
        vendorName: counterpartyName,
        candidates: serialized.map((tx) => ({ id: tx.id, text: describe({ tx }) })),
        allowJev,
      })
    : { similarityById: {}, usedJev: false };

  const byId = new Map(serialized.map((tx) => [tx.id, tx]));
  const scored = scoreCandidates({
    invoice,
    invoiceBaseAmount: baseAmount?.toNumber() ?? null,
    candidates: serialized.map((tx) => ({
      id: tx.id,
      amount: tx.amount,
      currencyCode: tx.currencyCode,
      refAmount: tx.refAmount,
      originalAmount: tx.originalAmount,
      originalCurrencyCode: tx.originalCurrencyCode,
      time: tx.time,
      hasAttachment: tx.hasAttachments ?? false,
      hasPayee: tx.payeeId !== null,
    })),
    merchantSimilarityById: similarityById,
    merchantKnown,
  });

  return {
    candidates: scored.map((entry) => ({
      transaction: byId.get(entry.id)!,
      score: entry.score,
      signals: entry.signals,
    })),
    usedJev,
  };
}

/**
 * Reads an uploaded invoice and ranks the transactions that could have paid it. Stores
 * nothing but the trial counter. A try is spent only once the ranking is in hand, so an
 * unsupported file, a "not an invoice" answer or a failed search costs the user nothing.
 */
export async function matchInvoice({
  userId,
  bytes,
  transactionType,
  access,
}: {
  userId: number;
  bytes: Buffer;
  transactionType: TRANSACTION_TYPES;
  access: Exclude<FeatureAccess, 'denied'>;
}): Promise<InvoiceMatchResult<TransactionApiResponse>> {
  const onTrial = access === 'trial';
  const { invoice, provider, modelId } = await extractInvoice({
    userId,
    bytes,
    transactionType,
    allowOperatorKey: onTrial,
  });

  const { candidates, usedJev } = await findInvoiceCandidates({ userId, invoice, allowJev: true });

  if (onTrial) {
    // The AI read is already paid for and the ranking is in hand; losing the counter is
    // cheaper than losing the answer.
    try {
      await recordFeatureUse({ userId, feature: FEATURES.invoice_matching });
    } catch (error) {
      logger.error('[Invoice Matching] Could not record the spent free try', { userId, error });
    }
  }

  trackInvoiceMatchRequested({
    userId,
    transactionType,
    candidatesCount: candidates.length,
    topScore: candidates[0]?.score ?? 0,
    provider,
    modelId,
    usedJev,
  });

  return { invoice, candidates };
}
