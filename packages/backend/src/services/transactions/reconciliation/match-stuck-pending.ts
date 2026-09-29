import type { RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { normalizePayeeName } from '@services/payees/normalize-name';

export interface StuckPendingMatchRow {
  id: RecordId;
  accountId: RecordId;
  transactionType: TRANSACTION_TYPES;
  time: Date;
  amountCents: number;
  payeeId: string | null;
  merchantName: string | null;
}

export const CANDIDATE_WINDOW_DAYS = 5;
const CANDIDATE_WINDOW_MS = CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const normalizeMerchant = ({ name }: { name: string | null }) =>
  name ? normalizePayeeName({ raw: name }) || null : null;

const isSamePayee = ({ a, b }: { a: StuckPendingMatchRow; b: StuckPendingMatchRow }) => {
  if (a.payeeId && b.payeeId) return a.payeeId === b.payeeId;
  const merchant = normalizeMerchant({ name: a.merchantName });
  return merchant !== null && merchant === normalizeMerchant({ name: b.merchantName });
};

/** Best booked candidate per stuck pending row, one-to-one. Returns pendingId → candidateId. */
export const matchStuckPending = ({
  pending,
  pool,
}: {
  pending: StuckPendingMatchRow[];
  pool: StuckPendingMatchRow[];
}): Map<RecordId, RecordId> => {
  const pairs: { pendingId: RecordId; candidateId: RecordId; amountDiff: number; timeDiff: number }[] = [];

  for (const p of pending) {
    for (const c of pool) {
      const timeDiff = c.time.getTime() - p.time.getTime();
      if (c.accountId !== p.accountId || c.transactionType !== p.transactionType) continue;
      if (timeDiff < 0 || timeDiff > CANDIDATE_WINDOW_MS) continue;
      if (!isSamePayee({ a: p, b: c })) continue;
      pairs.push({ pendingId: p.id, candidateId: c.id, amountDiff: Math.abs(c.amountCents - p.amountCents), timeDiff });
    }
  }

  pairs.sort(
    (a, b) =>
      a.amountDiff - b.amountDiff ||
      a.timeDiff - b.timeDiff ||
      a.pendingId.localeCompare(b.pendingId) ||
      a.candidateId.localeCompare(b.candidateId),
  );

  const matches = new Map<RecordId, RecordId>();
  const usedCandidates = new Set<RecordId>();
  for (const { pendingId, candidateId } of pairs) {
    if (matches.has(pendingId) || usedCandidates.has(candidateId)) continue;
    matches.set(pendingId, candidateId);
    usedCandidates.add(candidateId);
  }

  return matches;
};
