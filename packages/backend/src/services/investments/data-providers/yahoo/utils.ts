import { ASSET_CLASS, SECURITY_TYPE } from '@bt/shared/types/investments';

// ISO 6166 ISIN: 2-letter country code, 9 alphanumerics, 1 check digit.
// The check digit isn't validated – we only need to know whether the
// ISIN-fallback path is worth trying.
export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// Yahoo exchange suffixes the ISIN-fallback path fans out to. Yahoo's `quote`
// endpoint indexes UCITS funds by `<ISIN><suffix>` on these venues even though
// the bare ISIN is not searchable.
export const ISIN_EXCHANGE_SUFFIXES = ['.IR', '.DE', '.PA', '.AS', '.MI', '.L'] as const;

// Yahoo quotes some venues in minor units (LSE pence, JSE cents, TASE agorot)
// under a non-ISO currency code. Prices are scaled to the major unit at the
// provider boundary so the rest of the app only ever sees ISO currencies.
const MINOR_UNIT_CURRENCIES: Record<string, string> = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ILA: 'ILS' };

export const toMajorUnit = ({ price, currency }: { price: number; currency?: string }) =>
  currency && MINOR_UNIT_CURRENCIES[currency] ? price / 100 : price;

export const toIsoCurrency = (currency: string) => MINOR_UNIT_CURRENCIES[currency] ?? currency;

/**
 * Returns true when a quote() rejection is the routine "symbol doesn't exist
 * on this venue" case (404 HTTPError, NotFoundError, "not found" message).
 * Anything else – timeout, auth, rate-limit, schema validation – is operational
 * and the caller should surface it at error level so it isn't masked as routine.
 */
export function isExpectedNotFoundError(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const err = reason as { name?: string; message?: string; code?: number | string };
  if (err.code === 404 || err.code === '404') return true;
  if (typeof err.name === 'string' && err.name.toLowerCase().includes('notfound')) return true;
  if (typeof err.message === 'string' && /not\s*found/i.test(err.message)) return true;
  return false;
}

/**
 * Yahoo tags UCITS ETFs as `MUTUALFUND` even though they trade intraday with a
 * ticker. For ISIN-shaped queries the result set is exchange-traded-only by
 * construction, so the remap to `etf` is safe and routes them through the
 * stocks classifier instead of the fixed-income classifier where real mutuals
 * belong. Non-ISIN queries keep the original type so the service-layer filter
 * still drops genuine mutuals.
 */
export function remapUcitsType({
  rawType,
  isIsinQuery,
}: {
  rawType: string | undefined;
  isIsinQuery: boolean;
}): string | undefined {
  if (!isIsinQuery) return rawType;
  if (typeof rawType === 'string' && rawType.toLowerCase() === 'mutualfund') return 'etf';
  return rawType;
}

export function mapYahooTypeToAssetClass(typeDisp?: string): ASSET_CLASS {
  if (!typeDisp) return ASSET_CLASS.stocks;

  const type = typeDisp.toLowerCase();

  if (type === 'cryptocurrency') return ASSET_CLASS.crypto;
  if (type === 'option') return ASSET_CLASS.options;
  if (type === 'bond' || type === 'mutualfund') return ASSET_CLASS.fixed_income;

  return ASSET_CLASS.stocks;
}

// Keys are Yahoo's `quoteType` / `typeDisp` / chart `instrumentType`, lowercased.
const YAHOO_SECURITY_TYPES: Record<string, SECURITY_TYPE> = {
  equity: SECURITY_TYPE.stock,
  etf: SECURITY_TYPE.etf,
  mutualfund: SECURITY_TYPE.mutual_fund,
  fund: SECURITY_TYPE.mutual_fund,
  moneymarket: SECURITY_TYPE.mutual_fund,
  bond: SECURITY_TYPE.bond,
  cryptocurrency: SECURITY_TYPE.crypto,
  option: SECURITY_TYPE.option,
};

export const mapYahooTypeToSecurityType = ({ rawType }: { rawType: string | undefined }): SECURITY_TYPE | null =>
  rawType ? (YAHOO_SECURITY_TYPES[rawType.toLowerCase()] ?? SECURITY_TYPE.other) : null;
