import { SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import type YahooFinance from 'yahoo-finance2';

import {
  ISIN_EXCHANGE_SUFFIXES,
  isExpectedNotFoundError,
  mapYahooTypeToAssetClass,
  mapYahooTypeToSecurityType,
  remapUcitsType,
  toIsoCurrency,
} from './utils';

// Cap on the number of additional local-ticker candidates we'll quote per ISIN
// search – guards against a name-match search returning dozens of distantly
// related funds and triggering a quote storm.
const MAX_LOCAL_TICKER_CANDIDATES = 6;

type YahooClient = InstanceType<typeof YahooFinance>;
type YahooQuoteResult = Awaited<ReturnType<YahooClient['quote']>>;

/**
 * Resolves an ISIN-shaped query through Yahoo when the search endpoint can't
 * surface it. Two phases:
 *
 *  1. Fan out `quote(ISIN.suffix)` across common European exchange suffixes.
 *     Yahoo indexes UCITS funds by ISIN on a single registration venue (often
 *     `.IR` for Irish-domiciled funds) – that's the "primary" listing we find
 *     this way. It has sparse historical data on Yahoo's chart endpoint.
 *
 *  2. Take the resolved fund's longName and `search()` Yahoo by it. The same
 *     ETF trades on multiple exchanges under local tickers (e.g. `MEUD.PA`
 *     Paris, `CS51.DE` Xetra, `EUNL.L` London) – those local-ticker listings
 *     usually carry full daily history. We quote each candidate to confirm
 *     currency and venue, then surface them alongside the ISIN-suffix row so
 *     the user picks the one matching their broker.
 *
 * Phase-1 (ISIN-suffix) rows then have `priceSourceSymbol` set to the first
 * same-currency local-ticker symbol from phase 2. That preserves the row's
 * honest identity (`symbol`/`providerSymbol` stay as `IE00B53L3W79.IR`) while
 * giving the price-sync pipeline a venue with dense data to pull from.
 */
export async function resolveByIsinFallback({
  client,
  isin,
  seenSymbolsFromPrimary,
}: {
  client: YahooClient;
  isin: string;
  seenSymbolsFromPrimary: Set<string>;
}): Promise<SecuritySearchResult[]> {
  const suffixSymbols = ISIN_EXCHANGE_SUFFIXES.map((suffix) => `${isin}${suffix}`);
  const suffixQuotes = await Promise.allSettled(suffixSymbols.map((symbol) => client.quote(symbol)));

  const isinResults: SecuritySearchResult[] = [];
  // Seed with symbols the primary search already returned so the fallback
  // doesn't waste a `quote()` round-trip on a candidate the caller would
  // discard anyway.
  const seenSymbols = new Set<string>(seenSymbolsFromPrimary);
  let nameForLookup: string | undefined;
  let resolvedCount = 0;
  let emptyCount = 0;

  for (let i = 0; i < suffixQuotes.length; i++) {
    const settled = suffixQuotes[i]!;
    const suffixSymbol = suffixSymbols[i]!;

    if (settled.status === 'rejected') {
      // 404/NotFound rejections are normal – most ISIN-suffix combinations
      // don't resolve. Anything else (auth, rate limit, schema-broken) is
      // operational and worth surfacing at error level so it isn't masked as
      // "ISIN not listed".
      if (!isExpectedNotFoundError(settled.reason)) {
        logger.error({
          message: `Yahoo quote(${suffixSymbol}) failed with non-NotFound error during ISIN ${isin} fallback`,
          error: settled.reason as Error,
        });
      }
      continue;
    }

    const quote = settled.value;
    if (!quote || !quote.symbol || !quote.currency) {
      emptyCount++;
      if (quote && !quote.currency) {
        logger.info(`ISIN ${isin}: ${suffixSymbol} resolved without currency, skipping`);
      }
      continue;
    }

    const symbol = String(quote.symbol);
    if (seenSymbols.has(symbol)) continue;
    seenSymbols.add(symbol);
    resolvedCount++;

    isinResults.push(buildIsinFallbackResult({ quote, isin }));
    if (!nameForLookup) {
      const longName = 'longName' in quote ? quote.longName : undefined;
      const shortName = 'shortName' in quote ? quote.shortName : undefined;
      nameForLookup = longName ?? shortName;
    }
  }

  const localTickerResults = nameForLookup
    ? await findLocalTickersByName({ client, name: nameForLookup, isin, seenSymbols })
    : [];

  // Attach a same-currency local ticker as the price-source for each
  // ISIN-suffix row. Yahoo's chart endpoint is sparse for ISIN-suffix listings
  // but dense for the local tickers, so the row stays honest while the price
  // pipeline still gets usable data. Cross-currency venues are skipped on
  // purpose – storing GBP prices against an EUR row would be wrong; in that
  // (rare) case the user just gets empty charts.
  for (const isinRow of isinResults) {
    const sameCurrency = localTickerResults.find((lt) => lt.currencyCode === isinRow.currencyCode);
    if (sameCurrency) {
      isinRow.priceSourceSymbol = sameCurrency.providerSymbol;
      logger.info(
        `ISIN ${isin}: routing prices for ${isinRow.providerSymbol} via priceSourceSymbol=${sameCurrency.providerSymbol} (${isinRow.currencyCode})`,
      );
    } else if (localTickerResults.length > 0) {
      // Local tickers existed but none matched currency. Log the rejected
      // candidates so support can answer "why is this chart empty" without
      // re-running the search by hand.
      const rejected = localTickerResults.map((lt) => `${lt.providerSymbol}(${lt.currencyCode})`).join(', ');
      logger.info(
        `ISIN ${isin}: no same-currency local ticker for ${isinRow.providerSymbol} (${isinRow.currencyCode}); rejected: ${rejected}`,
      );
    }
  }

  const results = [...isinResults, ...localTickerResults];

  if (results.length === 0) {
    logger.info(
      `Yahoo ISIN fallback found no quote for ${isin}: ${resolvedCount} resolved, ${emptyCount} empty, ${suffixSymbols.length - resolvedCount - emptyCount} rejected across ${suffixSymbols.length} exchange suffixes`,
    );
  }

  return results;
}

/**
 * Builds a SecuritySearchResult from a `quote()` response. Shared by the
 * ISIN-suffix path and the name-lookup path so both produce identically
 * shaped rows. Caller is responsible for setting `priceSourceSymbol`
 * conditionally – this leaves it unset.
 */
function buildIsinFallbackResult({ quote, isin }: { quote: YahooQuoteResult; isin: string }): SecuritySearchResult {
  const symbol = String(quote.symbol);
  const longName = 'longName' in quote ? quote.longName : undefined;
  const shortName = 'shortName' in quote ? quote.shortName : undefined;
  const fullExchangeName = 'fullExchangeName' in quote ? quote.fullExchangeName : undefined;

  // All rows here come from an `<ISIN>.<suffix>` venue lookup, so they're
  // exchange-traded by construction – the UCITS-as-MUTUALFUND remap is
  // unconditionally safe.
  const rawType = typeof quote.quoteType === 'string' ? quote.quoteType : undefined;
  const effectiveType = remapUcitsType({ rawType, isIsinQuery: true });

  if (!quote.currency) {
    throw new Error(`buildIsinFallbackResult called for ${symbol} without currency`);
  }

  return {
    symbol,
    providerSymbol: symbol,
    name: longName ?? shortName ?? symbol,
    assetClass: mapYahooTypeToAssetClass(effectiveType),
    securityType: mapYahooTypeToSecurityType({ rawType: effectiveType }),
    providerName: SECURITY_PROVIDER.yahoo,
    exchangeName: fullExchangeName,
    exchangeAcronym: quote.exchange,
    exchangeMic: undefined,
    currencyCode: toIsoCurrency(quote.currency),
    cusip: undefined,
    isin,
  };
}

/**
 * Searches Yahoo by the fund's name to pick up local-ticker listings (e.g.
 * `MEUD.PA`) the ISIN-suffix path can't reach, then quote()s each candidate to
 * confirm currency and venue. Results are deduped against `seenSymbols` (which
 * the caller seeds with the ISIN-suffix matches already collected).
 *
 * `validateResult: false` is load-bearing on the name search – yahoo-finance2's
 * bundled JSON Schema misfires on European/UCITS-ETF queries with unfamiliar
 * fund metadata. The shape we read (`symbol`, `exchange`, `isYahooFinance`) is
 * stable.
 */
async function findLocalTickersByName({
  client,
  name,
  isin,
  seenSymbols,
}: {
  client: YahooClient;
  name: string;
  isin: string;
  seenSymbols: Set<string>;
}): Promise<SecuritySearchResult[]> {
  let candidateSymbols: string[];
  try {
    const lookup = (await client.search(name, { newsCount: 0 }, { validateResult: false })) as {
      quotes?: unknown[];
    };
    const quotes = Array.isArray(lookup.quotes) ? (lookup.quotes as Array<Record<string, unknown>>) : [];

    candidateSymbols = [];
    for (const q of quotes) {
      if (candidateSymbols.length >= MAX_LOCAL_TICKER_CANDIDATES) break;
      if (typeof q.symbol !== 'string' || q.symbol.length === 0 || q.isYahooFinance === false) continue;
      const symbol = q.symbol;
      if (symbol.toUpperCase().startsWith(isin)) continue;
      if (seenSymbols.has(symbol)) continue;
      candidateSymbols.push(symbol);
    }
  } catch (error) {
    // `validateResult: false` on the search above should make
    // FailedYahooValidationError impossible – anything throwing here is
    // operational (network, auth, rate-limit) or a library-guarantee
    // violation. Surface at error so it doesn't get silently downgraded to
    // "no local tickers exist".
    logger.error({
      message: `Local-ticker name search failed for ISIN ${isin} (name="${name}")`,
      error: error as Error,
    });
    return [];
  }

  if (candidateSymbols.length === 0) {
    logger.info(`No local tickers found for ISIN ${isin} via search("${name}")`);
    return [];
  }

  const settled = await Promise.allSettled(candidateSymbols.map((symbol) => client.quote(symbol)));
  const results: SecuritySearchResult[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const candidateSymbol = candidateSymbols[i]!;

    if (outcome.status === 'rejected') {
      if (!isExpectedNotFoundError(outcome.reason)) {
        logger.error({
          message: `Yahoo quote(${candidateSymbol}) failed with non-NotFound error during ISIN ${isin} name lookup`,
          error: outcome.reason as Error,
        });
      }
      continue;
    }

    const quote = outcome.value;
    if (!quote || !quote.symbol || !quote.currency) continue;

    const resolvedSymbol = String(quote.symbol);
    if (seenSymbols.has(resolvedSymbol)) continue;
    seenSymbols.add(resolvedSymbol);

    results.push(buildIsinFallbackResult({ quote, isin }));
  }

  if (results.length > 0) {
    logger.info(`ISIN ${isin}: surfaced ${results.length} additional local-ticker listing(s) via name search`);
  }
  return results;
}
