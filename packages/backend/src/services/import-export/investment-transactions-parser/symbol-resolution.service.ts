/**
 * Resolve AI-parsed symbol strings to Security rows + normalise currencies.
 *
 * Pure-ish helpers (the symbol part hits the DB and the provider). Designed
 * to be testable in isolation from the rest of the import pipeline.
 */
import { ASSET_CLASS, SECURITY_PROVIDER, type SecuritySearchResult } from '@bt/shared/types/investments';
import type {
  InvestmentImportWarning,
  ResolvedSecurityRef,
  SymbolResolutionConfidence,
} from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { dataProviderFactory } from '@services/investments/data-providers';

/**
 * USD-pegged stablecoins. Trades quoted in any of these are accounted as USD
 * cash. The user can override per row in the UI if they want to track a
 * specific stable separately.
 */
const USD_STABLECOINS = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'FDUSD', 'PYUSD']);

/**
 * Currencies that always exist in our `Currencies` reference table. Anything
 * else falls into the "user must fix" bucket.
 *
 * We don't query the table here — keep this resolver synchronous + cheap.
 * If a fiat ever isn't in our DB the executor will catch it at commit time.
 */
const KNOWN_FIATS = new Set([
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
  'KRW',
  'TRY',
  'AED',
  'PLN',
  'UAH',
  'CZK',
  'SEK',
  'NOK',
  'DKK',
  'HUF',
  'ILS',
  'THB',
]);

/**
 * Normalise the AI's quote-currency literal into an ISO-style code, or null
 * if we can't make sense of it (crypto-quoted pair, unknown token).
 *
 * Returning null is the "row is invalid" signal — the executor will refuse
 * to commit such rows and the UI will block until the user picks a currency.
 */
export function normaliseCurrency({ raw }: { raw: string | null | undefined }): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (!upper) return null;
  if (USD_STABLECOINS.has(upper)) return 'USD';
  if (KNOWN_FIATS.has(upper)) return upper;
  return null;
}

interface SymbolWithHint {
  symbol: string;
  assetClassHint: 'crypto' | 'stocks';
}

interface ResolveSymbolsParams {
  userId: number;
  /** Unique uppercased symbols + their AI-tagged asset class. */
  symbolsWithHints: SymbolWithHint[];
  /** Used to set `hasExistingHolding: true` when the resolved security already
   * lives in this portfolio — that drives the "will merge" indicator in the UI. */
  defaultPortfolioId: string;
}

interface ResolvedSymbol {
  parsedSymbol: string;
  resolvedSecurity: ResolvedSecurityRef | null;
  resolvedConfidence: SymbolResolutionConfidence;
  /** True iff the resolved security already has a holding in `defaultPortfolio`. */
  hasExistingHolding: boolean;
}

interface SymbolResolutionResult {
  bySymbol: Map<string, ResolvedSymbol>;
  /** Issues the UI should surface (e.g. provider failure for a specific
   * ticker). Empty when the resolver had a clean run. */
  warnings: InvestmentImportWarning[];
}

const hintToAssetClass = ({ hint }: { hint: 'crypto' | 'stocks' }): ASSET_CLASS =>
  hint === 'crypto' ? ASSET_CLASS.crypto : ASSET_CLASS.stocks;

function buildResolvedRef({ security }: { security: Securities }): ResolvedSecurityRef {
  return {
    securityId: security.id,
    providerSymbol: security.providerSymbol,
    symbol: security.symbol ?? '',
    name: security.name ?? '',
    assetClass: security.assetClass,
    providerName: security.providerName,
    currencyCode: security.currencyCode,
    exchangeName: security.exchangeName ?? undefined,
    cryptoCurrencyCode: security.cryptoCurrencyCode ?? undefined,
    alreadyInDb: true,
  };
}

function buildResolvedRefFromProvider({ hit }: { hit: SecuritySearchResult }): ResolvedSecurityRef {
  return {
    securityId: null,
    providerSymbol: hit.providerSymbol,
    symbol: hit.symbol.toUpperCase(),
    name: hit.name,
    assetClass: hit.assetClass,
    providerName: hit.providerName,
    currencyCode: hit.currencyCode,
    exchangeName: hit.exchangeName,
    cryptoCurrencyCode: hit.cryptoCurrencyCode,
    alreadyInDb: false,
  };
}

/**
 * Lookup priority for each parsed symbol:
 *
 *   1. The user already has a Security with this ticker in their portfolios.
 *      Use it — covers the most common "incremental import" case where the
 *      user has been tracking BTC for months and just dropped in a new CSV.
 *
 *   2. Otherwise ask the provider matching the row's assetClass hint (CoinGecko
 *      for crypto, composite for stocks). If exactly one exact-symbol match
 *      comes back and it has a market-cap rank (crypto) or any exact match
 *      (stocks), take it. Otherwise leave unresolved — there's no safe way to
 *      auto-pick between dozens of scam tokens / exchanges that share a
 *      ticker without showing the user the candidates.
 */
export async function resolveSymbols({
  userId,
  symbolsWithHints,
  defaultPortfolioId,
}: ResolveSymbolsParams): Promise<SymbolResolutionResult> {
  const out = new Map<string, ResolvedSymbol>();
  const warnings: InvestmentImportWarning[] = [];
  if (symbolsWithHints.length === 0) return { bySymbol: out, warnings };

  // Dedupe by ticker — if the AI tagged the same ticker with conflicting
  // hints across rows (rare), prefer the first hint we saw.
  const hintBySymbol = new Map<string, 'crypto' | 'stocks'>();
  for (const { symbol, assetClassHint } of symbolsWithHints) {
    const upper = symbol.toUpperCase();
    if (!hintBySymbol.has(upper)) hintBySymbol.set(upper, assetClassHint);
  }
  const uniqUpper = Array.from(hintBySymbol.keys());

  // Step 1: securities the user already holds anywhere — keyed by ticker.
  //
  // Two queries instead of one big nested include: easier to keep the
  // sequelize-typescript association aliases correct, and the working set is
  // small (one row per symbol the AI returned).
  const userPortfolios = await Portfolios.findAll({ where: { userId }, attributes: ['id'] });
  const userPortfolioIds = userPortfolios.map((p) => p.id);

  const userByTicker = new Map<string, { security: Securities; hasExistingHolding: boolean }>();

  if (userPortfolioIds.length > 0) {
    const userHoldings = await Holdings.findAll({
      where: { portfolioId: userPortfolioIds },
      attributes: ['portfolioId', 'securityId'],
    });
    if (userHoldings.length > 0) {
      const securityIds = Array.from(new Set(userHoldings.map((h) => h.securityId)));
      // No assetClass filter here — when the user has been tracking AAPL the
      // stocks lookup should hit it even if the AI tagged the row as crypto.
      const securities = await Securities.findAll({
        where: { id: securityIds, symbol: uniqUpper },
      });
      const portfoliosBySecurityId = new Map<string, Set<string>>();
      for (const h of userHoldings) {
        const set = portfoliosBySecurityId.get(h.securityId);
        if (set) set.add(h.portfolioId);
        else portfoliosBySecurityId.set(h.securityId, new Set([h.portfolioId]));
      }
      for (const sec of securities) {
        const ticker = sec.symbol?.toUpperCase();
        if (!ticker) continue;
        // Only auto-attach when the user's existing security matches the AI's
        // class hint — otherwise the user's AAPL stock would silently absorb a
        // crypto row tagged AAPL (and vice versa). When the hint disagrees we
        // fall through to the provider lookup, where the right asset class
        // wins.
        if (sec.assetClass !== hintToAssetClass({ hint: hintBySymbol.get(ticker)! })) continue;
        const portfolios = portfoliosBySecurityId.get(sec.id) ?? new Set<string>();
        const inDefault = portfolios.has(defaultPortfolioId);
        const existing = userByTicker.get(ticker);
        if (!existing) {
          userByTicker.set(ticker, { security: sec, hasExistingHolding: inDefault });
        } else if (!existing.hasExistingHolding && inDefault) {
          userByTicker.set(ticker, { security: sec, hasExistingHolding: true });
        }
      }
    }
  }

  // Step 2: provider search for the symbols that didn't resolve from the user's
  // own securities. Route each ticker to the provider matching its asset class.
  const unresolvedTickers = uniqUpper.filter((t) => !userByTicker.has(t));
  const providerHits = new Map<string, SecuritySearchResult[]>();
  if (unresolvedTickers.length > 0) {
    const provider = dataProviderFactory.getProvider();
    await Promise.all(
      unresolvedTickers.map(async (ticker) => {
        const assetClass = hintToAssetClass({ hint: hintBySymbol.get(ticker)! });
        try {
          const results = await provider.searchSecurities(ticker, { assetClass });
          providerHits.set(
            ticker,
            results.filter((r) => r.assetClass === assetClass),
          );
        } catch (error) {
          // Provider failures (network blip, rate limit) used to be silently
          // converted to "unmapped" — now we record the symbol + reason so the
          // UI can show "couldn't reach CoinGecko for SOL, try again later"
          // instead of misleadingly suggesting SOL doesn't exist.
          logger.warn(`[Investment import] Provider lookup failed for "${ticker}"`, {
            reason: error instanceof Error ? error.message : String(error),
          });
          warnings.push({ code: 'PROVIDER_LOOKUP_FAILED', params: { symbol: ticker } });
          providerHits.set(ticker, []);
        }
      }),
    );
  }

  for (const ticker of uniqUpper) {
    const fromUser = userByTicker.get(ticker);
    if (fromUser) {
      out.set(ticker, {
        parsedSymbol: ticker,
        resolvedSecurity: buildResolvedRef({ security: fromUser.security }),
        resolvedConfidence: 'auto',
        hasExistingHolding: fromUser.hasExistingHolding,
      });
      continue;
    }

    const hits = providerHits.get(ticker) ?? [];
    // Only count hits that *exactly* match the parsed ticker — partial matches
    // are too noisy for an auto-pick (e.g. searching "OP" surfaces results for
    // every security whose name contains "Op…").
    const exact = hits.filter((h) => h.symbol.toUpperCase() === ticker);
    const assetClass = hintToAssetClass({ hint: hintBySymbol.get(ticker)! });

    // Crypto auto-pick: rank by market cap, take the unique top.
    // Stocks auto-pick: take the single exact match if there's exactly one.
    let pick: SecuritySearchResult | null = null;
    let ambiguous = false;
    if (assetClass === ASSET_CLASS.crypto) {
      const ranked = exact
        .filter((h) => h.marketCapRank != null)
        .toSorted(
          (a, b) => (a.marketCapRank ?? Number.POSITIVE_INFINITY) - (b.marketCapRank ?? Number.POSITIVE_INFINITY),
        );
      if (ranked.length === 1) pick = ranked[0]!;
      else if (ranked.length > 1) ambiguous = true;
    } else {
      if (exact.length === 1) pick = exact[0]!;
      else if (exact.length > 1) ambiguous = true;
    }

    if (pick) {
      out.set(ticker, {
        parsedSymbol: ticker,
        resolvedSecurity: buildResolvedRefFromProvider({ hit: pick }),
        resolvedConfidence: 'auto',
        hasExistingHolding: false,
      });
      continue;
    }

    out.set(ticker, {
      parsedSymbol: ticker,
      resolvedSecurity: null,
      resolvedConfidence: ambiguous ? 'ambiguous' : 'unmapped',
      hasExistingHolding: false,
    });
  }

  return { bySymbol: out, warnings };
}

/**
 * Provider-preference matrix lookup. Exported so e2e tests can assert wiring
 * without spinning up the composite provider directly.
 */
export function providerForAssetClass({ assetClass }: { assetClass: ASSET_CLASS }): SECURITY_PROVIDER {
  if (assetClass === ASSET_CLASS.crypto) return SECURITY_PROVIDER.coingecko;
  return SECURITY_PROVIDER.composite;
}
