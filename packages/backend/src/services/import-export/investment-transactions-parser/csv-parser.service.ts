/**
 * Parse a broker CSV export into `NormalizedInvestmentRow[]` using a
 * user-provided column mapping. Drop-in companion to the AI extraction path —
 * downstream pipeline (`groupRowsIntoHoldings` → review → execute) is the same.
 *
 * The shared `parseCSV` helper from the bank-import service does the actual
 * row tokenisation + delimiter detection (fully domain-agnostic). This file
 * adds the investment-specific column mapping + per-field validation on top.
 */
import { MAX_CSV_ROWS } from '@bt/shared/types';
import {
  INVESTMENT_IMPORT_SIDE_SKIP,
  type InvestmentColumnMapping,
  INVESTMENT_TRANSACTION_CATEGORY,
  type InvestmentImportCsvRowWarningCode,
  type InvestmentImportSideSkip,
  type InvestmentImportTransactionSide,
} from '@bt/shared/types/investments';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { parseDate } from '@services/import-export/core/parse/parse-date';
import { Big } from 'big.js';
import { parse } from 'csv-parse/sync';

import { parseCSV } from '../csv-import/csv-parser.service';
import type { NormalizedInvestmentRow } from './group-rows-into-holdings.service';
import { normaliseCurrency } from './symbol-resolution.service';

interface InvalidRow {
  /** 1-based row index in the source CSV (data row 1 = the first non-header row). */
  rowIndex: number;
  code: InvestmentImportCsvRowWarningCode;
  /** The raw cell that failed to parse. */
  value?: string;
}

interface ParseInvestmentCsvResult {
  rows: NormalizedInvestmentRow[];
  invalidRows: InvalidRow[];
  totalRows: number;
  /**
   * Count of rows the user explicitly mapped to the SKIP sentinel. Surfaced as
   * a warning so the user can confirm e.g. their cash-movement rows got
   * dropped on purpose — without this they'd see fewer transactions than
   * their file contains with no breadcrumb why.
   */
  skippedRowsCount: number;
}

/**
 * Parse a positive decimal string with tolerant locale handling. Returns the
 * canonical decimal-string form for downstream Big.js usage, or null when
 * the input doesn't parse as a finite positive number.
 *
 * We can't reuse the bank-import `parseAmount` directly — that one returns
 * cents (integer) and accepts signed amounts. Investment quantities/prices
 * are unsigned decimals; sign is encoded in the side column.
 */
function parseDecimal(raw: string): string | null {
  if (!raw) return null;
  let clean = raw.trim();
  if (!clean) return null;

  // Strip currency symbols and whitespace.
  clean = clean.replace(/[$€£¥₴₽\s]/g, '');

  // Decide which separator is the decimal — whichever occurs last. Handles
  // both US (1,234.56) and EU (1.234,56) thousands grouping.
  const lastComma = clean.lastIndexOf(',');
  const lastPeriod = clean.lastIndexOf('.');
  if (lastComma > lastPeriod) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else {
    clean = clean.replace(/,/g, '');
  }

  // Tolerate explicit `+` prefix; reject explicit negatives (sign belongs in side).
  if (clean.startsWith('+')) clean = clean.slice(1);
  if (clean.startsWith('-')) return null;

  try {
    const b = new Big(clean);
    if (b.lt(0)) return null;
    return b.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve a CSV-side value to the canonical category or the skip sentinel.
 * Tries exact match first, then a normalised lower-case lookup so common
 * vocabulary variants ("Buy"/"BUY"/"buy") work without the user mapping all
 * casings explicitly.
 */
function resolveSide({
  raw,
  mapping,
}: {
  raw: string;
  mapping: InvestmentColumnMapping['sideValueMapping'];
}): InvestmentImportTransactionSide | InvestmentImportSideSkip | null {
  if (raw in mapping) return mapping[raw]!;
  const lower = raw.trim().toLowerCase();
  for (const [key, value] of Object.entries(mapping)) {
    if (key.trim().toLowerCase() === lower) return value;
  }
  return null;
}

/**
 * Split a compound ticker like `SOL-USD` (Yahoo Finance convention) into its
 * security symbol and its quote currency — but only when the suffix matches a
 * known fiat/stablecoin. Otherwise the dash is part of the actual ticker
 * (e.g. `BRK-B` for Berkshire Hathaway Class B).
 *
 * Returns the original symbol with `currency = null` when no split applies, so
 * the caller can fall through to the explicit currency column / default.
 */
function splitCompoundTicker({ raw }: { raw: string }): { symbol: string; currency: string | null } {
  const match = raw.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
  if (!match) return { symbol: raw, currency: null };
  const [, head, tail] = match;
  if (!head || !tail) return { symbol: raw, currency: null };
  // Only split when the tail is a currency we'd accept downstream. Anything
  // else is part of the ticker (BRK-B, RDS-A, …).
  if (normaliseCurrency({ raw: tail }) === null) return { symbol: raw, currency: null };
  return { symbol: head, currency: tail };
}

/**
 * Read the value for `header` from a row indexed by its position in `headers`.
 * Returns empty string when the column is missing — same convention as the
 * bank-import preview builder.
 */
function readCell({ row, header, headers }: { row: string[]; header: string | null; headers: string[] }): string {
  if (!header) return '';
  const idx = headers.indexOf(header);
  if (idx < 0) return '';
  return (row[idx] ?? '').trim();
}

export function parseInvestmentCsv({
  fileContent,
  columnMapping,
}: {
  fileContent: string;
  columnMapping: InvestmentColumnMapping;
}): ParseInvestmentCsvResult {
  // Reuse the bank-import generic parseCSV to validate the file shape (empty
  // file, missing headers, forbidden header names, row cap) and discover the
  // delimiter + header row. We then re-parse the full content below to walk
  // every row — the helper's preview-only output is shape-validated but trims
  // at `previewLimit`.
  const { detectedDelimiter, headers } = parseCSV({ fileContent, previewLimit: 1 });

  // Validate every mapped column actually exists in the headers. Without this
  // guard a typo in the column-mapping UI would silently produce empty-string
  // fields and we'd fail every row with "bad date / bad number".
  const mappedHeaders = [
    columnMapping.symbol,
    columnMapping.date,
    columnMapping.side,
    columnMapping.quantity,
    columnMapping.price,
    columnMapping.fees,
    columnMapping.currency,
    columnMapping.name,
  ];
  for (const header of mappedHeaders) {
    if (header && !headers.includes(header)) {
      throw new ValidationError({
        message: t({ key: 'investments.import.csvColumnNotFound', variables: { column: header } }),
      });
    }
  }

  // Wrap the full-content parse: csv-parse throws on mid-file structural
  // issues (unterminated quote, etc.) that parseCSV's preview-only scan can
  // miss. Surface as ValidationError so the user sees a malformed-file message.
  let records: string[][];
  try {
    records = parse(fileContent, {
      delimiter: detectedDelimiter,
      skipEmptyLines: true,
      relaxColumnCount: true,
      trim: true,
      columns: false,
    }) as string[][];
  } catch {
    throw new ValidationError({ message: t({ key: 'csvImport.csvFileMalformed' }) });
  }

  // First row is header (already validated by parseCSV above). Walk data rows.
  const dataRows = records.slice(1);
  const totalRows = dataRows.length;

  if (totalRows > MAX_CSV_ROWS) {
    throw new ValidationError({
      message: t({ key: 'csvImport.csvFileTooManyRows', variables: { max: MAX_CSV_ROWS } }),
    });
  }

  const rows: NormalizedInvestmentRow[] = [];
  const invalidRows: InvalidRow[] = [];
  let skippedRowsCount = 0;

  dataRows.forEach((dataRow, dataRowIdx) => {
    const rowIndex = dataRowIdx + 1;
    const rawSymbol = readCell({ row: dataRow, header: columnMapping.symbol, headers }).toUpperCase();
    if (!rawSymbol) {
      invalidRows.push({ rowIndex, code: 'CSV_ROW_MISSING_SYMBOL' });
      return;
    }
    // Compound tickers (SOL-USD, BTC-USDT) get split — security symbol is the
    // head, suffix becomes the row's fallback currency.
    const { symbol, currency: tickerCurrency } = splitCompoundTicker({ raw: rawSymbol });

    const dateRaw = readCell({ row: dataRow, header: columnMapping.date, headers });
    const date = parseDate(dateRaw);
    if (!date) {
      invalidRows.push({ rowIndex, code: 'CSV_ROW_INVALID_DATE', value: dateRaw });
      return;
    }

    const sideRaw = readCell({ row: dataRow, header: columnMapping.side, headers });
    const side = resolveSide({ raw: sideRaw, mapping: columnMapping.sideValueMapping });
    if (!side) {
      invalidRows.push({ rowIndex, code: 'CSV_ROW_UNMAPPED_SIDE', value: sideRaw });
      return;
    }
    // User explicitly marked this side value as "skip" — drop the row, but
    // count it so the controller can surface "N rows skipped on purpose" as a
    // warning. Without the count the user sees fewer transactions than their
    // file contained with no clue why.
    if (side === INVESTMENT_IMPORT_SIDE_SKIP) {
      skippedRowsCount += 1;
      return;
    }

    const quantityRaw = readCell({ row: dataRow, header: columnMapping.quantity, headers });
    const quantity = parseDecimal(quantityRaw);
    if (!quantity || new Big(quantity).lte(0)) {
      invalidRows.push({ rowIndex, code: 'CSV_ROW_INVALID_QUANTITY', value: quantityRaw });
      return;
    }

    const priceRaw = readCell({ row: dataRow, header: columnMapping.price, headers });
    const price = parseDecimal(priceRaw);
    // Allow zero for non-trade categories (dividend, fee, transfer) and for
    // crypto airdrops / staking rewards that brokers occasionally encode as
    // zero-price buys. Reject only when the source text was completely unparseable.
    if (price === null) {
      const isTrade = side === INVESTMENT_TRANSACTION_CATEGORY.buy || side === INVESTMENT_TRANSACTION_CATEGORY.sell;
      // Trades MUST have a parseable price (even if zero) — a non-numeric value
      // is a parsing failure, not a "free" trade.
      if (isTrade) {
        invalidRows.push({ rowIndex, code: 'CSV_ROW_INVALID_PRICE', value: priceRaw });
        return;
      }
    }

    const feesRaw = readCell({ row: dataRow, header: columnMapping.fees, headers });
    const fees = feesRaw ? parseDecimal(feesRaw) : '0';
    if (fees === null) {
      invalidRows.push({ rowIndex, code: 'CSV_ROW_INVALID_FEES', value: feesRaw });
      return;
    }

    const currencyRaw = readCell({ row: dataRow, header: columnMapping.currency, headers });
    // Precedence: explicit currency column > compound-ticker suffix > default.
    // Ticker suffix sits between explicit column and default because it's
    // row-specific signal — better than a global default but trumped by the
    // user explicitly mapping a currency column.
    const currency =
      currencyRaw.toUpperCase() || tickerCurrency || columnMapping.defaultCurrency?.toUpperCase() || null;

    const name = readCell({ row: dataRow, header: columnMapping.name, headers }) || null;

    rows.push({
      symbol,
      name,
      date,
      side,
      quantity,
      price: price ?? '0',
      fees,
      currency,
      assetClassHint: columnMapping.defaultAssetClassHint,
    });
  });

  return { rows, invalidRows, totalRows, skippedRowsCount };
}
