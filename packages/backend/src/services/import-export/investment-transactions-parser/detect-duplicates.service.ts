/**
 * Possible-duplicate detection for investment transactions.
 *
 * Run server-side at extract time *only for already-resolved securities* —
 * unresolved holdings can't be looked up yet. For each (portfolio, security)
 * pair, look for existing transactions on the same `side` whose `price` AND
 * `amount` match exactly (decimal-equal — formatting variants like "0.5" vs
 * "0.50000000" still match) AND whose `date` is within ±3 days of the parsed
 * row.
 *
 * Why a date window instead of an exact match: brokers and exchanges report
 * the same trade with slightly different date stamps depending on
 * settlement/timezone (e.g. a trade executed late on Friday in NY may post
 * as Monday in another export). ±3 days catches typical cross-source skew
 * without producing false positives on independent trades.
 *
 * Why strict on price + amount instead of quantity-with-tolerance: amount
 * is the strongest "is this the same trade?" signal — fees can vary across
 * sources but the executed price and total cash impact don't. If both match
 * exactly, it's the same trade.
 */
import { toUtcDateString } from '@common/utils/date';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import { Big } from 'big.js';
import { Op } from 'sequelize';

/** Days on either side of a parsed row's date that we consider "the same trade." */
export const DUPLICATE_DATE_WINDOW_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Stringify the dedup-group key tuple. Hoisted to satisfy `consistent-function-scoping`. */
function groupKey({ portfolioId, securityId }: { portfolioId: string; securityId: string }): string {
  return `${portfolioId}|${securityId}`;
}

interface DuplicateCandidate {
  /** Identifies the parsed transaction we matched against an existing one. */
  tempId: string;
  /** id of the existing InvestmentTransaction we believe this duplicates. */
  existingTransactionId: string;
}

interface ParsedRowForDedup {
  tempId: string;
  portfolioId: string;
  securityId: string;
  /** YYYY-MM-DD. */
  date: string;
  side: 'buy' | 'sell';
  /** Decimal string. */
  price: string;
  /** Decimal string (`quantity * price ± fees`, minus for sell). */
  amount: string;
}

/**
 * Decimal-equal comparison via Big.eq — handles formatting variants like
 * "0.5" vs "0.50000000" while staying strict on actual value. Exported for unit
 * testing.
 */
export function decimalsEqual({ a, b }: { a: string; b: string }): boolean {
  return new Big(a).eq(new Big(b));
}

/**
 * Absolute day difference between two dates. Inputs may be `Date` objects
 * (e.g. a TIMESTAMPTZ `InvestmentTransaction.date` from the DB) or `YYYY-MM-DD`
 * strings (parsed CSV rows); both are normalized to their UTC calendar day via
 * `toUtcDateString` and interpreted as UTC midnight. Anchoring to the UTC day
 * keeps the comparison calendar-day-granular and avoids the off-by-one DST
 * drift we'd get if we let Date parse local time. Exported for unit testing.
 */
export function dayDiff({ a, b }: { a: Date | string; b: Date | string }): number {
  const dayA = toUtcDateString(a);
  const dayB = toUtcDateString(b);
  const ms = Date.parse(`${dayA}T00:00:00Z`) - Date.parse(`${dayB}T00:00:00Z`);
  return Math.abs(Math.round(ms / MS_PER_DAY));
}

function shiftDate({ date, days }: { date: string; days: number }): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Find possible duplicates for a batch of parsed rows. Returns one entry per
 * matched row — at most one duplicate per row (the first existing match,
 * earliest by id). Multiple matches per row are noise the UI doesn't need.
 */
export async function detectInvestmentDuplicates({
  userId,
  rows,
}: {
  userId: number;
  rows: ParsedRowForDedup[];
}): Promise<DuplicateCandidate[]> {
  if (rows.length === 0) return [];

  // Group rows by (portfolioId, securityId) so we can hit the DB once per
  // group rather than once per row. Date no longer participates in the key
  // because we look across a ±3-day window.
  const groups = new Map<string, ParsedRowForDedup[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const candidates: DuplicateCandidate[] = [];

  for (const [, groupRows] of groups) {
    const sample = groupRows[0]!;
    // Span: from `min(date) - 3d` to `max(date) + 3d` covers every row in
    // the group with a single DB hit. Sorting via toSorted to keep the
    // helper pure.
    const sortedDates = groupRows.map((r) => r.date).toSorted();
    const earliest = sortedDates[0]!;
    const latest = sortedDates[sortedDates.length - 1]!;
    const windowStart = shiftDate({ date: earliest, days: -DUPLICATE_DATE_WINDOW_DAYS });
    const windowEnd = shiftDate({ date: latest, days: DUPLICATE_DATE_WINDOW_DAYS });

    const existingTxs = await InvestmentTransaction.findAll({
      where: {
        portfolioId: sample.portfolioId,
        securityId: sample.securityId,
        // `date` is TIMESTAMPTZ, so anchor the ±3-day window to full UTC days:
        // lower = windowStart start-of-day UTC, upper = windowEnd end-of-day UTC.
        // A bare `windowEnd` upper bound would cast to midnight UTC and miss
        // that day's later intraday rows, shrinking the window.
        date: { [Op.between]: [`${windowStart}T00:00:00.000Z`, `${windowEnd}T23:59:59.999Z`] },
      },
      include: [
        {
          model: Portfolios,
          as: 'portfolio',
          attributes: [],
          where: { userId },
          required: true,
        },
      ],
      attributes: ['id', 'transactionType', 'price', 'amount', 'date'],
    });

    if (existingTxs.length === 0) continue;

    for (const row of groupRows) {
      const match = existingTxs.find((existing) => {
        const existingSide = existing.transactionType === 'expense' ? 'buy' : 'sell';
        if (existingSide !== row.side) return false;
        if (dayDiff({ a: existing.date, b: row.date }) > DUPLICATE_DATE_WINDOW_DAYS) return false;
        if (!decimalsEqual({ a: existing.price.toDecimalString(10), b: row.price })) return false;
        if (!decimalsEqual({ a: existing.amount.toDecimalString(10), b: row.amount })) return false;
        return true;
      });

      if (match) {
        candidates.push({ tempId: row.tempId, existingTransactionId: match.id });
      }
    }
  }

  return candidates;
}
