/**
 * Types for AI-powered investment transactions import.
 *
 * Pipeline mirrors `statement-parser` for bank statements:
 *   file (or pasted text) → text extract → AI parse → review/edit → execute
 *
 * One key difference: review is hierarchical. AI returns a flat list of
 * transactions; the server groups them by parsed symbol into "holding rows"
 * (the parents) with the original transactions hanging off them as children.
 * The user edits both levels and commits.
 */
import type { StatementFileType } from '../import-export/statement-parser';
import type { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from './enums';

/**
 * String-literal union over `INVESTMENT_TRANSACTION_CATEGORY` values. Used on
 * the import wire because it accepts both plain string literals (`'buy'`) and
 * enum members (`INVESTMENT_TRANSACTION_CATEGORY.buy`), which keeps test
 * fixtures and JSON payloads ergonomic.
 */
export type InvestmentImportTransactionSide = `${INVESTMENT_TRANSACTION_CATEGORY}`;

/**
 * Narrow trade-only subset of the side union. The executor only fully models
 * buy/sell today (cost basis, quantity check, cash delta direction); non-trade
 * categories ride the same wire shape but require their own handling. Guards
 * on this subset prevent silent misclassification at the seam.
 */
export type InvestmentImportTradeSide = Extract<InvestmentImportTransactionSide, 'buy' | 'sell'>;

/** Type guard: is this side value one the executor can handle as a trade? */
export function isTradeSide(side: InvestmentImportTransactionSide): side is InvestmentImportTradeSide {
  return side === 'buy' || side === 'sell';
}

/**
 * Sentinel value used in `InvestmentColumnMapping.sideValueMapping` to mark a
 * raw CSV side value as "drop these rows silently." Two use cases:
 *
 *   1. CSV cells with bogus content (escaping artefacts, free-text notes that
 *      leaked into the side column).
 *   2. Action types we don't model yet — cash deposits/withdrawals are the
 *      common ones brokers ship in the same export as trades.
 *
 * Skip-mapped rows don't appear in the holdings result and don't fill the
 * invalid-rows warnings list either — they were deliberate.
 */
export const INVESTMENT_IMPORT_SIDE_SKIP = 'skip' as const;
export type InvestmentImportSideSkip = typeof INVESTMENT_IMPORT_SIDE_SKIP;

/**
 * Result of resolving an AI-parsed symbol to a CoinGecko/FMP/etc security.
 * - `auto`: server picked a single confident match (user can still override).
 * - `ambiguous`: provider returned multiple plausible candidates; user must pick.
 * - `unmapped`: no provider candidate at all (typo, dead token); user must pick or delete.
 */
export type SymbolResolutionConfidence = 'auto' | 'ambiguous' | 'unmapped';

/**
 * Identity of a security the user has picked (or the server auto-matched) for
 * a holding row. Carries every field the executor needs to upsert the row
 * later, so no extra provider lookup is required at execute time. Mirrors the
 * essential subset of `SecuritySearchResult` (see `security.model.ts`).
 */
export interface ResolvedSecurityRef {
  /** Existing Security.id if the security already lives in our DB. */
  securityId: string | null;
  /** Canonical provider symbol (CoinGecko coin slug for crypto, ticker for stocks). */
  providerSymbol: string;
  /** Display ticker. */
  symbol: string;
  /** Display name. */
  name: string;
  /** Asset class — drives which provider handles this row at execute time. */
  assetClass: ASSET_CLASS;
  /** Provider that authoritatively owns this security identity (CoinGecko, FMP, …). */
  providerName: SECURITY_PROVIDER;
  /** Native trade/quote currency for the security (e.g. USD for AAPL, USD for BTC). */
  currencyCode: string;
  /** Exchange name when known (NASDAQ, NYSE, "CoinGecko" for crypto). Optional. */
  exchangeName?: string;
  /** Crypto-specific code (e.g. "BTC") — only populated when assetClass is crypto. */
  cryptoCurrencyCode?: string;
  /** Whether the security row already exists in DB (vs has to be created at execute). */
  alreadyInDb: boolean;
}

export interface InvestmentImportTransaction {
  /** Stable UI key (not persisted). */
  tempId: string;
  /** YYYY-MM-DD, UTC (server collapses any AI-returned time-of-day). */
  date: string;
  /**
   * Action category — buy/sell for trades, plus dividend/transfer/tax/fee/etc.
   * for non-trade rows that brokers often include in CSV exports. AI extraction
   * still only emits buy/sell; CSV import can produce any category.
   */
  side: InvestmentImportTransactionSide;
  /** Decimal string (Money convention). */
  quantity: string;
  /** Decimal string. */
  price: string;
  /** Decimal string. 0 if AI didn't extract a fee. */
  fees: string;
  /** Computed convenience: `quantity * price + fees`, decimal string. */
  amount: string;
  /**
   * If this transaction is a possible duplicate of an existing one, the
   * id of the existing transaction. UI shows a badge; user can opt to skip.
   */
  possibleDuplicateOf: string | null;
}

export interface InvestmentImportHolding {
  /** Stable UI key (not persisted). */
  tempId: string;

  /** Raw symbol the AI returned (e.g. "BTC", "SOL/USDT"). */
  parsedSymbol: string;
  /** Raw name the AI returned, if any (e.g. "Bitcoin"). */
  parsedName: string | null;

  /** Server-resolved security (null until user picks). */
  resolvedSecurity: ResolvedSecurityRef | null;
  resolvedConfidence: SymbolResolutionConfidence;

  /** Target portfolio for this holding's transactions. */
  portfolioId: string;
  /**
   * Fiat currency the cash side of the trade is denominated in (USD, EUR, …).
   * null = invalid (crypto-quoted pair, unknown token); blocks commit.
   */
  currencyCode: string | null;
  /**
   * Whether the target portfolio already has a holding for this security.
   * Holdings have a composite PK `(portfolioId, securityId)` so we surface the
   * merge intent as a boolean rather than an id. The executor re-derives the
   * actual row from `(portfolioId, securityId)` at commit time.
   */
  hasExistingHolding: boolean;

  transactions: InvestmentImportTransaction[];
}

/**
 * Per-CSV-import column mapping. Each field carries the CSV header name to
 * read for that field; `null` means the field isn't represented in the CSV
 * (server will fall back to defaults or surface the row as invalid).
 *
 * `sideValueMapping` translates the raw cell values in the side column (e.g.
 * `B`/`S`, `Buy`/`Sell`, `Compra`/`Venta`) into the canonical
 * `InvestmentImportTransactionSide` values. Built at column-mapping time by
 * showing the user the unique values found in the side column.
 */
export interface InvestmentColumnMapping {
  symbol: string;
  date: string;
  side: string;
  quantity: string;
  price: string;
  fees: string | null;
  currency: string | null;
  /** Optional column with full security name (e.g. "Apple Inc."). */
  name: string | null;
  /**
   * Fallback currency for rows where the currency column is unmapped or empty.
   * null = no fallback (row's currencyCode stays null and may be inferred from
   * the resolved security downstream).
   */
  defaultCurrency: string | null;
  /**
   * Default asset class hint applied to every row. Broker CSVs are usually
   * single-class (stocks-only or crypto-only) so a per-mapping default is
   * enough — user picks at mapping time.
   */
  defaultAssetClassHint: 'crypto' | 'stocks';
  /**
   * Maps raw CSV side-cell values to canonical sides. Case-sensitive lookup.
   * The `INVESTMENT_IMPORT_SIDE_SKIP` sentinel marks rows we should drop
   * silently (unsupported action types, garbage cell content).
   */
  sideValueMapping: Record<string, InvestmentImportTransactionSide | InvestmentImportSideSkip>;
}

export interface InvestmentImportExtractionResult {
  /** Hierarchical: one row per parsed security with child transactions. */
  holdings: InvestmentImportHolding[];
  /** Human-readable warnings (e.g. "12 rows had no symbol — skipped"). */
  warnings: string[];
  /** Detected file type (matches statement-parser). */
  fileType: StatementFileType;
  /** Approximate token usage from the AI call. */
  tokenCount: {
    input: number;
    output: number;
  };
}

export interface InvestmentImportError {
  code:
    | 'NO_AI_CONFIGURED'
    | 'INVALID_FILE'
    | 'FILE_TOO_LARGE'
    | 'EXTRACTION_FAILED'
    | 'NO_TRANSACTIONS_FOUND'
    | 'AI_ERROR'
    | 'RATE_LIMITED'
    | 'TOKEN_LIMIT_EXCEEDED'
    | 'NOT_IMPLEMENTED'
    /** The model's reply was cut off at its output limit, so the rows are incomplete. */
    | 'OUTPUT_TRUNCATED';
  message: string;
  details?: string;
}

/* ---------- request shapes ---------- */

export interface InvestmentImportEstimateCostRequest {
  fileBase64: string;
}

export interface InvestmentImportExtractAiRequest {
  /** Discriminator. Omit (or set to 'ai') for AI extraction. */
  source?: 'ai';
  fileBase64: string;
  /** Pre-selected by the entry point (portfolio page) — server uses this as the
   * default `portfolioId` on every parsed holding row. */
  defaultPortfolioId: string;
}

export interface InvestmentImportExtractCsvRequest {
  source: 'csv';
  fileBase64: string;
  defaultPortfolioId: string;
  columnMapping: InvestmentColumnMapping;
}

export type InvestmentImportExtractRequest = InvestmentImportExtractAiRequest | InvestmentImportExtractCsvRequest;

export interface InvestmentImportExecuteRequest {
  /** The (validated, possibly user-edited) holdings to commit. Each holding's
   * asset class lives on `resolvedSecurity.assetClass`. */
  holdings: InvestmentImportHolding[];
  /** tempIds of transactions the user opted to skip (possible duplicates). */
  skipTempIds: string[];
}

/* ---------- response shapes ---------- */

export interface InvestmentImportExecuteResponse {
  createdSecurities: number;
  createdHoldings: number;
  mergedHoldings: number;
  createdTransactions: number;
  /** Transactions whose `tempId` was in `skipTempIds` (user marked them as dups). */
  skippedPossibleDuplicates: number;
  /** Holdings the server refused to commit (unresolved security, missing currency,
   * portfolio not owned by user, security row could not be created). */
  skippedHoldings: number;
  /** Transactions that threw inside `createInvestmentTransaction` after passing
   * validation. Counted separately from successful creates so the summary
   * doesn't claim a full import when some rows actually failed. */
  failedTransactions: number;
  /** Human-readable details about anything that was skipped/failed. Empty when
   * everything imported cleanly. */
  warnings: string[];
}
