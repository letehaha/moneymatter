import type { TransactionModel } from '../transactions';

/** What started an AI categorization run, as opposed to what categorized a row (`CATEGORIZATION_SOURCE`). */
export enum CATEGORIZATION_TRIGGER {
  manual = 'manual',
  import = 'import',
  sync = 'sync',
}

/**
 * Why the AI declined to pick a category for a row it was shown. The row still gets the
 * run's stamp so it leaves the candidate pool, but its category stays untouched.
 */
export enum CATEGORIZATION_SKIP_REASON {
  /** Money moved between accounts or people (P2P), not a purchase. */
  transfer = 'transfer',
  /** Not enough information in the row to decide. */
  unclear = 'unclear',
  /** None of the offered categories applies. */
  no_fit = 'no_fit',
  /** The model returned no verdict for the row at all (e.g. answered in prose). */
  unspecified = 'unspecified',
}

/**
 * Cap on how many transactions one manual categorization trigger processes — the whole
 * id list is serialized into the queue payload, so it must stay bounded.
 */
export const AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN = 5000;

/**
 * Response of POST /user/ai/categorization/trigger. `enqueued: false` means there was
 * nothing left to categorize, which is a success rather than an error.
 */
export interface AiCategorizationTriggerResponse {
  enqueued: boolean;
  totalCount: number;
}

/**
 * Response of GET /user/ai/categorization/candidates.
 *
 * `totalCount` is only filled on the first page (`offset === 0`) and is `null` on every later
 * one, so an infinite scroll doesn't pay for a COUNT per page. It is uncapped, so it can
 * exceed both `items.length` and what a single trigger processes.
 */
export interface AiCategorizationCandidatesResponse<TTransaction = TransactionModel> {
  items: TTransaction[];
  totalCount: number | null;
}

/**
 * One AI categorization run in GET /user/ai/categorization/history. All transactions
 * of a run share a single `categorizationMeta.categorizedAt` stamp, so the stamp doubles
 * as the run identifier for drilling into GET /transactions.
 */
export interface AiCategorizationRunSummary {
  /** ISO timestamp shared by every transaction the run categorized. */
  categorizedAt: string;
  transactionCount: number;
  /** `null` on runs stamped before triggers were recorded. */
  trigger: CATEGORIZATION_TRIGGER | null;
}

/**
 * Response of GET /user/ai/categorization/history. `totalCount` is only filled on the
 * first page (`offset === 0`) and is `null` on every later one.
 *
 * Counts reflect the current state, not what the run originally did: a transaction the
 * user re-categorized by hand leaves its run, and a run whose every transaction was
 * corrected disappears from the list.
 */
export interface AiCategorizationHistoryResponse {
  items: AiCategorizationRunSummary[];
  totalCount: number | null;
}
