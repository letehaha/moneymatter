import { SUPPORTED_ASSET_CLASSES, SecuritySearchResult } from '@bt/shared/types/investments';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Securities from '@models/investments/securities.model';
import { withTransaction } from '@services/common/with-transaction';

import { SecurityIdentity, securityIdentityBatchWhere, securityIdentityKey } from './securities/identity';
import { getVerifiedSearchResults } from './securities/verified-search-cache';

const REFRESHABLE_FIELDS = [
  'name',
  'exchangeMic',
  'exchangeAcronym',
  'exchangeName',
  'cryptoCurrencyCode',
  'logoUrl',
  'priceSourceSymbol',
] as const;

const findByIdentity = async ({ identities }: { identities: SecurityIdentity[] }) => {
  const where = securityIdentityBatchWhere(identities);
  const rows = where === null ? [] : await Securities.findAll({ where });
  return new Map(rows.map((row) => [securityIdentityKey(row), row]));
};

const upsertSecuritiesFromSearchImpl = async ({
  securities: incoming,
}: {
  securities: SecurityIdentity[];
}): Promise<{ newCount: number; securities: Securities[] }> => {
  if (incoming.length === 0) {
    return { newCount: 0, securities: [] };
  }

  // Securities rows are shared by every user and the incoming results come from request bodies,
  // so request fields only pick the provider-returned copy remembered at search time; only that
  // copy is ever written, and its identity decides which row is resolved.
  const verifiedCopies = await getVerifiedSearchResults({ securities: incoming });
  const identities: SecurityIdentity[] = incoming.map((sec, index) => verifiedCopies[index] ?? sec);

  const existingByKey = await findByIdentity({ identities });
  const securitiesToCreate: SecuritySearchResult[] = [];

  for (const [index, identity] of identities.entries()) {
    const verified = verifiedCopies[index];
    const existing = existingByKey.get(securityIdentityKey(identity));

    if (!existing) {
      if (!verified || !SUPPORTED_ASSET_CLASSES.includes(verified.assetClass)) {
        throw new ValidationError({ message: t({ key: 'investments.securitySearchResultNotRecognized' }) });
      }
      securitiesToCreate.push(verified);
      continue;
    }

    if (
      !verified ||
      existing.providerName !== verified.providerName ||
      existing.providerSymbol !== verified.providerSymbol
    ) {
      continue;
    }

    const refresh = Object.fromEntries(
      REFRESHABLE_FIELDS.map((field) => [field, verified[field]]).filter(([, value]) => value != null && value !== ''),
    );
    if (Object.keys(refresh).length > 0) {
      await existing.update(refresh);
    }
  }

  const newCount = securitiesToCreate.length;
  logger.info(`New securities to add: ${newCount}. Existing rows matched: ${incoming.length - newCount}.`);

  if (newCount) {
    await Securities.bulkCreate(
      securitiesToCreate.map((security) => ({
        symbol: security.symbol,
        providerSymbol: security.providerSymbol,
        priceSourceSymbol: security.priceSourceSymbol ?? null,
        name: security.name,
        assetClass: security.assetClass,
        providerName: security.providerName,
        currencyCode: security.currencyCode.toUpperCase(),
        cryptoCurrencyCode: security.cryptoCurrencyCode ?? null,
        exchangeMic: security.exchangeMic,
        exchangeAcronym: security.exchangeAcronym || null,
        exchangeName: security.exchangeName || null,
        logoUrl: security.logoUrl ?? null,
        isBrokerageCash: false,
      })),
    );
  }

  const resolvedByKey = newCount ? await findByIdentity({ identities }) : existingByKey;
  const securities = identities.map((identity) => resolvedByKey.get(securityIdentityKey(identity)));
  if (securities.some((security) => !security)) {
    throw new Error('Security upsert completed but a security row was not found.');
  }

  return { newCount, securities: securities as Securities[] };
};

/**
 * Creates or refreshes Securities rows from search results the server itself received from a
 * provider, and returns the resolved row for each input in input order. A result with no
 * remembered copy can't create a row and leaves an existing row as is.
 */
export const upsertSecuritiesFromSearch = withTransaction(upsertSecuritiesFromSearchImpl);
