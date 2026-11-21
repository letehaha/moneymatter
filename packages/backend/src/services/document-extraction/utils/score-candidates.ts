import type { InvoiceAmountSignal, InvoiceMatchSignals, InvoiceMerchantSignal } from '@bt/shared/types';

const AMOUNT_WEIGHT = 0.5;
const DATE_WEIGHT = 0.25;
const MERCHANT_WEIGHT = 0.25;

/** Relative amount gap at which the amount signal decays to zero. */
export const AMOUNT_TOLERANCE = 0.05;
/** Below this absolute gap the two amounts are the same money. */
const AMOUNT_EXACT_EPSILON = 0.005;
/** A base-currency comparison can never be as trustworthy as a same-currency one. */
const CONVERTED_AMOUNT_CAP = 0.9;
/** Card payments settle a few percent off the stored market rate, so a gap this small is not a mismatch. */
const CONVERTED_MARKUP_ALLOWANCE = 0.035;

export const DAYS_BEFORE_INVOICE = 14;
export const DAYS_AFTER_INVOICE = 30;

const MERCHANT_MATCH_THRESHOLD = 0.8;
const MERCHANT_PARTIAL_THRESHOLD = 0.4;

/** A transaction that already carries a document is unlikely to be the one being attached. */
const ALREADY_ATTACHED_MULTIPLIER = 0.9;

const MIN_SCORE = 20;
const MAX_RESULTS = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScoringCandidate {
  id: string;
  /** Decimal, positive. */
  amount: number;
  currencyCode: string;
  /** Decimal, positive, in the user's base currency. */
  refAmount: number;
  /** Decimal; what the merchant charged before the bank converted it, when the transaction carries it. */
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  time: Date | string;
  hasAttachment: boolean;
  hasPayee: boolean;
}

interface ScoredCandidate {
  id: string;
  score: number;
  signals: InvoiceMatchSignals;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const falloff = ({ gap, limit }: { gap: number; limit: number }) => clamp01(1 - gap / limit);

const scoreAmount = ({
  candidate,
  invoiceAmount,
  invoiceCurrencyCode,
  invoiceBaseAmount,
}: {
  candidate: ScoringCandidate;
  invoiceAmount: number;
  invoiceCurrencyCode: string;
  invoiceBaseAmount: number | null;
}): { score: number; signal: InvoiceAmountSignal; diff: number | null } => {
  let sameCurrencyAmount: number | null = null;
  if (candidate.currencyCode === invoiceCurrencyCode) sameCurrencyAmount = candidate.amount;
  else if (candidate.originalCurrencyCode === invoiceCurrencyCode) sameCurrencyAmount = candidate.originalAmount;

  if (sameCurrencyAmount !== null) {
    const diff = Math.abs(sameCurrencyAmount - invoiceAmount);
    if (diff < AMOUNT_EXACT_EPSILON) return { score: 1, signal: 'exact', diff: null };
    return { score: falloff({ gap: diff / invoiceAmount, limit: AMOUNT_TOLERANCE }), signal: 'close', diff };
  }

  if (invoiceBaseAmount === null) return { score: 0, signal: 'unknown', diff: null };

  const baseDiff = Math.abs(candidate.refAmount - invoiceBaseAmount);
  const gapPastAllowance = Math.max(0, baseDiff / invoiceBaseAmount - CONVERTED_MARKUP_ALLOWANCE);
  const score =
    CONVERTED_AMOUNT_CAP * falloff({ gap: gapPastAllowance, limit: AMOUNT_TOLERANCE - CONVERTED_MARKUP_ALLOWANCE });
  return { score, signal: 'converted', diff: null };
};

const daysFromInvoice = ({ time, issueDate }: { time: Date | string; issueDate: string }): number => {
  const tx = new Date(time);
  const txDay = Date.UTC(tx.getUTCFullYear(), tx.getUTCMonth(), tx.getUTCDate());
  return Math.round((txDay - Date.parse(`${issueDate}T00:00:00.000Z`)) / MS_PER_DAY);
};

const scoreDate = ({ days }: { days: number }): number =>
  days >= 0 ? falloff({ gap: days, limit: DAYS_AFTER_INVOICE }) : falloff({ gap: -days, limit: DAYS_BEFORE_INVOICE });

const merchantSignal = ({ similarity }: { similarity: number }): InvoiceMerchantSignal => {
  if (similarity >= MERCHANT_MATCH_THRESHOLD) return 'match';
  if (similarity >= MERCHANT_PARTIAL_THRESHOLD) return 'partial';
  return 'none';
};

/**
 * Ranks the transactions that could be the payment for one invoice. Pure: every input the
 * ranking depends on (currency conversion, merchant similarity) is resolved by the caller.
 */
export function scoreCandidates({
  invoice,
  invoiceBaseAmount,
  candidates,
  merchantSimilarityById,
  merchantKnown,
}: {
  invoice: { totalAmount: number; currencyCode: string; issueDate: string };
  invoiceBaseAmount: number | null;
  candidates: ScoringCandidate[];
  merchantSimilarityById: Record<string, number>;
  /** False when the invoice names no counterparty, so no candidate's merchant can be judged. */
  merchantKnown: boolean;
}): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const amount = scoreAmount({
        candidate,
        invoiceAmount: invoice.totalAmount,
        invoiceCurrencyCode: invoice.currencyCode,
        invoiceBaseAmount,
      });
      const days = daysFromInvoice({ time: candidate.time, issueDate: invoice.issueDate });
      const similarity = clamp01(merchantSimilarityById[candidate.id] ?? 0);
      const textSignal = merchantSignal({ similarity });
      // Only a payee is evidence about a merchant. Without one the term stays at the unknown
      // baseline, so a note that half-names the vendor can never rank below no hint at all.
      const isMerchantUnknown = !merchantKnown || (!candidate.hasPayee && textSignal === 'none');
      const merchantScore = !merchantKnown || !candidate.hasPayee ? 1 : similarity;

      const weighted =
        amount.score * AMOUNT_WEIGHT + scoreDate({ days }) * DATE_WEIGHT + merchantScore * MERCHANT_WEIGHT;
      const penalised = candidate.hasAttachment ? weighted * ALREADY_ATTACHED_MULTIPLIER : weighted;

      return {
        id: candidate.id,
        score: Math.round(penalised * 100),
        signals: {
          amount: amount.signal,
          amountDiff: amount.diff,
          daysFromInvoice: days,
          merchant: isMerchantUnknown ? 'unknown' : textSignal,
        },
      };
    })
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
