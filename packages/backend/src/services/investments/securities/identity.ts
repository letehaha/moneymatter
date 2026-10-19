import { ASSET_CLASS } from '@bt/shared/types/investments';
import Securities from '@models/investments/securities.model';
import { Op, WhereOptions } from 'sequelize';

/**
 * Canonical identity of a Security across providers.
 *
 * For non-crypto assets the same ticker on the same exchange is the SAME
 * logical security regardless of which provider sourced this particular hit –
 * Yahoo MSFT/USD, FMP MSFT/USD and Polygon MSFT/USD all describe the one
 * stock. Keying by `providerName:providerSymbol` would let the same row exist
 * once per provider, breaking portfolio duplicate detection.
 *
 * Crypto stays keyed by `providerName:providerSymbol` because the ticker alone
 * is ambiguous (CoinGecko uses slugs like `bitcoin`; other providers may use
 * `BTC` directly).
 */
export type SecurityIdentity = {
  assetClass: ASSET_CLASS;
  providerName: string;
  providerSymbol: string;
  symbol: string | null;
  currencyCode: string;
};

const stockSymbolPart = (s: SecurityIdentity): string => (s.symbol ?? s.providerSymbol).toUpperCase();

/** Stable in-memory key – use to dedupe across sets or build lookup maps. */
export const securityIdentityKey = (s: SecurityIdentity): string => {
  if (s.assetClass === ASSET_CLASS.crypto) {
    return `crypto:${s.providerName}:${s.providerSymbol}`;
  }
  return `stock:${stockSymbolPart(s)}:${s.currencyCode.toUpperCase()}`;
};

/** Sequelize WHERE resolving to the single existing Security matching `s`. */
const securityIdentityWhere = (s: SecurityIdentity): WhereOptions => {
  if (s.assetClass === ASSET_CLASS.crypto) {
    return { providerName: s.providerName, providerSymbol: s.providerSymbol };
  }
  return {
    symbol: s.symbol ?? s.providerSymbol,
    currencyCode: s.currencyCode.toUpperCase(),
    assetClass: { [Op.ne]: ASSET_CLASS.crypto },
  };
};

/**
 * Sequelize WHERE resolving to every existing Security matching ANY of the
 * given identities. Returns null when `shapes` is empty so the caller can
 * skip the query entirely.
 */
export const securityIdentityBatchWhere = (shapes: SecurityIdentity[]): WhereOptions | null => {
  if (shapes.length === 0) return null;

  const crypto = shapes.filter((s) => s.assetClass === ASSET_CLASS.crypto);
  const nonCrypto = shapes.filter((s) => s.assetClass !== ASSET_CLASS.crypto);

  const conditions: WhereOptions[] = [];
  if (crypto.length > 0) {
    conditions.push({
      assetClass: ASSET_CLASS.crypto,
      providerName: { [Op.in]: Array.from(new Set(crypto.map((s) => s.providerName))) },
      providerSymbol: { [Op.in]: Array.from(new Set(crypto.map((s) => s.providerSymbol))) },
    });
  }
  if (nonCrypto.length > 0) {
    conditions.push({
      assetClass: { [Op.ne]: ASSET_CLASS.crypto },
      symbol: { [Op.in]: Array.from(new Set(nonCrypto.map((s) => s.symbol ?? s.providerSymbol))) },
      currencyCode: { [Op.in]: Array.from(new Set(nonCrypto.map((s) => s.currencyCode.toUpperCase()))) },
    });
  }

  return conditions.length === 1 ? conditions[0]! : { [Op.or]: conditions };
};

/** Returns the existing Security row matching `s`, or null. */
export const findSecurityByIdentity = (s: SecurityIdentity) => Securities.findOne({ where: securityIdentityWhere(s) });
