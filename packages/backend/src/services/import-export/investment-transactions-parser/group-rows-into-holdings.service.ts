/**
 * Group flat parsed investment rows into hierarchical holdings.
 *
 * Shared by both extraction paths (AI and CSV). Each path produces a flat list
 * of normalized rows (one per transaction); this helper:
 *   1. Groups by symbol.
 *   2. Majority-votes asset class per symbol.
 *   3. Resolves symbols to Security candidates.
 *   4. Normalises quote currencies.
 *   5. Computes amounts (`quantity * price ± fees`, minus for sell/dividend).
 *   6. Flags possible duplicates against existing transactions.
 *
 * Output is the hierarchical `InvestmentImportExtractionResult['holdings']`
 * shape consumed by the review UI.
 */
import { ASSET_CLASS, isCashInCategory, isTradeSide } from '@bt/shared/types/investments';
import type {
  InvestmentImportExtractionResult,
  InvestmentImportTradeSide,
  InvestmentImportWarning,
  InvestmentImportTransactionSide,
} from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import { Big } from 'big.js';
import { v4 as uuidv4 } from 'uuid';

import { detectInvestmentDuplicates } from './detect-duplicates.service';
import { normaliseCurrency, resolveSymbols } from './symbol-resolution.service';

/**
 * The minimum shape both AI and CSV parsing must produce per transaction row.
 * Numbers are decimal strings; `currency` and `name` are raw user-input values
 * (the helper does its own currency normalisation).
 */
export interface NormalizedInvestmentRow {
  symbol: string;
  name: string | null;
  date: string;
  /** Trade direction or non-trade action (dividend, transfer, fee, …). */
  side: InvestmentImportTransactionSide;
  quantity: string;
  price: string;
  fees: string;
  /** Raw quote currency literal as it appears in the source (USDT, USD, EUR, ""). */
  currency: string | null;
  /** Best-effort asset class hint; used for symbol resolution. */
  assetClassHint: 'crypto' | 'stocks';
}

interface GroupRowsParams {
  rows: NormalizedInvestmentRow[];
  userId: number;
  defaultPortfolioId: string;
  /**
   * Extra warnings appended after symbol-resolution warnings and before
   * per-symbol currency warnings. Lets callers preserve the existing AI-path
   * ordering for things like "AI dropped N rows".
   */
  extraWarnings?: InvestmentImportWarning[];
}

interface GroupRowsResult {
  holdings: InvestmentImportExtractionResult['holdings'];
  warnings: InvestmentImportWarning[];
}

export async function groupRowsIntoHoldings({
  rows,
  userId,
  defaultPortfolioId,
  extraWarnings = [],
}: GroupRowsParams): Promise<GroupRowsResult> {
  const bySymbol = new Map<string, NormalizedInvestmentRow[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol);
    if (list) list.push(row);
    else bySymbol.set(row.symbol, [row]);
  }

  // Majority-vote asset class per ticker. Ties go to crypto — matches the
  // legacy crypto-first behaviour the original implementation had.
  const symbolsWithHints = Array.from(bySymbol.entries()).map(([symbol, symbolRows]) => {
    let crypto = 0;
    let stocks = 0;
    for (const r of symbolRows) {
      if (r.assetClassHint === 'crypto') crypto += 1;
      else stocks += 1;
    }
    return { symbol, assetClassHint: (stocks > crypto ? 'stocks' : 'crypto') as 'crypto' | 'stocks' };
  });

  const resolution = await resolveSymbols({
    userId,
    symbolsWithHints,
    defaultPortfolioId,
  });

  const warnings: InvestmentImportWarning[] = [...resolution.warnings, ...extraWarnings];

  const holdings: InvestmentImportExtractionResult['holdings'] = [];
  const rowsForDedup: Array<{
    tempId: string;
    portfolioId: string;
    securityId: string;
    date: string;
    side: InvestmentImportTradeSide;
    price: string;
    amount: string;
  }> = [];

  for (const [symbol, symbolRows] of bySymbol) {
    const resolved = resolution.bySymbol.get(symbol);

    const normalisedCurrencies = symbolRows.map((r) => normaliseCurrency({ raw: r.currency }));
    let currencyCode = normalisedCurrencies.find((c) => c !== null) ?? null;
    const invalidCount = normalisedCurrencies.filter((c) => c === null).length;

    // Fall back to the resolved security's native currency for stocks when the
    // source row had no recognisable quote currency. NOT applied for crypto —
    // crypto/crypto pairs come in with empty quote currency on purpose and
    // must stay null so the UI prompts the user to fix.
    if (
      !currencyCode &&
      resolved?.resolvedSecurity?.currencyCode &&
      resolved.resolvedSecurity.assetClass !== ASSET_CLASS.crypto
    ) {
      currencyCode = resolved.resolvedSecurity.currencyCode.toUpperCase();
    }

    if (invalidCount > 0) {
      warnings.push({ code: 'UNSUPPORTED_QUOTE_CURRENCY', params: { symbol, count: invalidCount } });
    }

    const holdingTempId = uuidv4();
    const txns = symbolRows.map((row) => {
      const tempId = uuidv4();
      const notional = new Big(row.quantity).times(new Big(row.price));
      const amount = (
        isCashInCategory({ category: row.side }) ? notional.minus(row.fees) : notional.plus(row.fees)
      ).toFixed(10);
      // Dedup is only meaningful for trades — dividends/fees/etc. don't have a
      // price-based "is this the same event?" signal. Restrict the dedup batch
      // to buy/sell and rely on the same-value comparison in detect-duplicates.
      if (isTradeSide(row.side) && resolved?.resolvedSecurity?.securityId) {
        rowsForDedup.push({
          tempId,
          portfolioId: defaultPortfolioId,
          securityId: resolved.resolvedSecurity.securityId,
          date: row.date,
          side: row.side,
          price: row.price,
          amount,
        });
      }
      return {
        tempId,
        date: row.date,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        fees: row.fees,
        amount,
        possibleDuplicateOf: null as string | null,
      };
    });

    holdings.push({
      tempId: holdingTempId,
      parsedSymbol: symbol,
      parsedName: symbolRows[0]?.name ?? null,
      resolvedSecurity: resolved?.resolvedSecurity ?? null,
      resolvedConfidence: resolved?.resolvedConfidence ?? 'unmapped',
      portfolioId: defaultPortfolioId,
      currencyCode,
      hasExistingHolding: resolved?.hasExistingHolding ?? false,
      transactions: txns,
    });
  }

  if (rowsForDedup.length > 0) {
    try {
      const candidates = await detectInvestmentDuplicates({
        userId,
        rows: rowsForDedup,
      });
      const byTempId = new Map(candidates.map((c) => [c.tempId, c.existingTransactionId]));
      for (const holding of holdings) {
        for (const tx of holding.transactions) {
          const match = byTempId.get(tx.tempId);
          if (match) tx.possibleDuplicateOf = match;
        }
      }
    } catch (error) {
      // Dedup failure shouldn't tank the whole extract — log it AND surface a
      // warning so the user knows the duplicate badges aren't reliable for
      // this import (otherwise they'd assume "no badges = no duplicates").
      logger.error({
        message: 'Investment txn import dedup detection failed',
        error: error as Error,
      });
      warnings.push({ code: 'DUPLICATE_CHECK_FAILED' });
    }
  }

  return { holdings, warnings };
}
