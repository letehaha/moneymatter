import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';

/**
 * Normalize a transaction note for grouping:
 * - Lowercase, trim
 * - Strip reference numbers (6+ digit sequences)
 * - Strip date-like patterns (dd/mm/yyyy, yyyy-mm-dd, etc.)
 * - Strip special chars except spaces
 * - Collapse whitespace
 */
export function normalizeNote({ note }: { note: string }): string {
  let normalized = note.toLowerCase().trim();

  // Strip reference numbers (6+ consecutive digits)
  normalized = normalized.replace(/\b\d{6,}\b/g, '');

  // Strip date patterns: dd/mm/yyyy, dd.mm.yyyy, yyyy-mm-dd, dd-mm-yyyy
  normalized = normalized.replace(/\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/g, '');

  // Strip remaining special characters (keep letters, digits, spaces)
  normalized = normalized.replace(/[^a-z0-9\s]/g, '');

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Build a grouping key for a transaction based on its normalized note,
 * accountId, and currencyCode.
 */
export function buildGroupingKey({
  normalizedNote,
  accountId,
  currencyCode,
}: {
  normalizedNote: string;
  accountId: string;
  currencyCode: string;
}): string {
  return `${normalizedNote}||${accountId}||${currencyCode}`;
}

export interface TransactionForGrouping {
  id: string;
  /** Decimal amount in the transaction's currency. Grouping compares ratios only, so the scale does not matter. */
  amount: number;
  note: string;
  time: Date;
  accountId: string;
  currencyCode: string;
}

export interface TransactionGroup {
  normalizedNote: string;
  accountId: string;
  currencyCode: string;
  transactions: TransactionForGrouping[];
  rawNotes: string[];
}

/**
 * Group transactions by their signature (normalizedNote + accountId + currencyCode).
 * Only returns groups with at least `minOccurrences` transactions.
 */
export function groupTransactionsBySignature({
  transactions,
  minOccurrences = 3,
}: {
  transactions: TransactionForGrouping[];
  minOccurrences?: number;
}): TransactionGroup[] {
  const groups = new Map<string, TransactionGroup>();

  for (const tx of transactions) {
    const normalizedNote = normalizeNote({ note: tx.note || '' });
    if (!normalizedNote) continue;

    const key = buildGroupingKey({
      normalizedNote,
      accountId: tx.accountId,
      currencyCode: tx.currencyCode,
    });

    if (!groups.has(key)) {
      groups.set(key, {
        normalizedNote,
        accountId: tx.accountId,
        currencyCode: tx.currencyCode,
        transactions: [],
        rawNotes: [],
      });
    }

    const group = groups.get(key)!;
    group.transactions.push(tx);
    group.rawNotes.push(tx.note || '');
  }

  return Array.from(groups.values()).filter((g) => g.transactions.length >= minOccurrences);
}

/**
 * Compute the coefficient of variation (stdev / mean) for an array of numbers.
 * Returns 0 if fewer than 2 values or if mean is 0.
 */
export function computeCV({ values }: { values: number[] }): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return 0;

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Split a group into amount buckets with a given tolerance (fractional, e.g. 0.10 = 10%).
 * Returns sub-groups where each bucket's amounts are within tolerance of the bucket's mean.
 */
export function splitByAmountBuckets({
  transactions,
  tolerance = 0.1,
}: {
  transactions: TransactionForGrouping[];
  tolerance?: number;
}): TransactionForGrouping[][] {
  const sorted = transactions.toSorted((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
  const buckets: TransactionForGrouping[][] = [];

  for (const tx of sorted) {
    const absAmount = Math.abs(tx.amount);
    let placed = false;

    for (const bucket of buckets) {
      const bucketMean = bucket.reduce((sum, t) => sum + Math.abs(t.amount), 0) / bucket.length;
      if (bucketMean > 0 && Math.abs(absAmount - bucketMean) / bucketMean <= tolerance) {
        bucket.push(tx);
        placed = true;
        break;
      }
    }

    if (!placed) {
      buckets.push([tx]);
    }
  }

  return buckets;
}

/**
 * Compute intervals (in days) between sorted dates.
 */
export function computeIntervals({ dates }: { dates: Date[] }): number[] {
  if (dates.length < 2) return [];

  const sorted = dates.toSorted((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const diffMs = sorted[i]!.getTime() - sorted[i - 1]!.getTime();
    intervals.push(diffMs / (1000 * 60 * 60 * 24));
  }

  return intervals;
}

/**
 * Compute the median of a sorted or unsorted array of numbers.
 */
export function computeMedian({ values }: { values: number[] }): number {
  if (values.length === 0) return 0;

  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Map a median interval (days) to the closest subscription frequency.
 */
export function mapIntervalToFrequency({ medianDays }: { medianDays: number }): SUBSCRIPTION_FREQUENCIES {
  if (medianDays <= 10) return SUBSCRIPTION_FREQUENCIES.weekly;
  if (medianDays <= 21) return SUBSCRIPTION_FREQUENCIES.biweekly;
  if (medianDays <= 50) return SUBSCRIPTION_FREQUENCIES.monthly;
  if (medianDays <= 120) return SUBSCRIPTION_FREQUENCIES.quarterly;
  if (medianDays <= 270) return SUBSCRIPTION_FREQUENCIES.semiAnnual;
  return SUBSCRIPTION_FREQUENCIES.annual;
}

/**
 * Compute a confidence score for a candidate group.
 *
 * confidenceScore = 0.4 * occurrenceScore + 0.6 * regularityScore
 * where:
 *   occurrenceScore = min(1.0, occurrenceCount / 12)
 *   regularityScore = max(0.0, 1.0 - intervalCV)
 */
export function computeConfidenceScore({
  occurrenceCount,
  intervalCV,
}: {
  occurrenceCount: number;
  intervalCV: number;
}): number {
  const occurrenceScore = Math.min(1.0, occurrenceCount / 12);
  const regularityScore = Math.max(0.0, 1.0 - intervalCV);
  return 0.4 * occurrenceScore + 0.6 * regularityScore;
}

/**
 * Check if two names are a fuzzy match by comparing their space-stripped
 * normalized forms. Also handles containment (e.g. "Netflix" matches
 * "Netflix subscription").
 */
export function isFuzzyNameMatch({ a, b }: { a: string; b: string }): boolean {
  const normA = normalizeNote({ note: a }).replace(/\s+/g, '');
  const normB = normalizeNote({ note: b }).replace(/\s+/g, '');

  if (!normA || !normB) return false;

  return normA === normB || normA.includes(normB) || normB.includes(normA);
}

/**
 * Find the most common raw note in a group (the suggested name).
 */
export function findMostCommonNote({ notes }: { notes: string[] }): string {
  const counts = new Map<string, number>();
  for (const note of notes) {
    counts.set(note, (counts.get(note) || 0) + 1);
  }

  let bestNote = notes[0] || '';
  let bestCount = 0;
  for (const [note, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestNote = note;
    }
  }
  return bestNote;
}
