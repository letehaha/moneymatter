import { SecuritySearchResult } from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import Securities from '@models/investments/securities.model';
import { withTransaction } from '@services/common/with-transaction';

import { securityIdentityBatchWhere, securityIdentityKey } from './securities/identity';

const createMissingSecuritiesImpl = async ({
  securities: securitiesFromProvider,
}: {
  securities: SecuritySearchResult[];
}): Promise<{ newCount: number }> => {
  if (!securitiesFromProvider || securitiesFromProvider.length === 0) {
    logger.info('No securities provided to sync. Aborting.');
    return { newCount: 0 };
  }

  // Look up potential existing matches in a single query. The where clause
  // mixes a crypto branch (providerName + providerSymbol) and a non-crypto
  // branch (symbol + currency) so the same logical security doesn't get a
  // second row when an incoming search comes from a different provider.
  const lookupWhere = securityIdentityBatchWhere(securitiesFromProvider);

  const existingSecurities =
    lookupWhere === null
      ? []
      : await Securities.findAll({
          where: lookupWhere,
          attributes: ['providerName', 'providerSymbol', 'symbol', 'currencyCode', 'assetClass'],
          raw: true,
        });

  const existingKeys = new Set(existingSecurities.map((e) => securityIdentityKey(e)));

  // A row that already stands for the security is left as stored: Securities rows are shared by
  // every user, and the incoming results can come from a request body, so they never overwrite
  // the name, logo, price source or exchange of an existing row.
  const newSecurities = securitiesFromProvider.filter((sec) => !existingKeys.has(securityIdentityKey(sec)));

  const newCount = newSecurities.length;
  logger.info(
    `New securities to add: ${newCount}. Existing rows left unchanged: ${securitiesFromProvider.length - newCount}.`,
  );

  // Prepare bulk insert payload for new securities
  const securitiesToCreate = newSecurities.map((security) => ({
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
  }));

  if (securitiesToCreate.length) {
    await Securities.bulkCreate(securitiesToCreate);
  }

  return { newCount };
};

/**
 * Takes a list of security search results from any provider, checks against
 * the local database, and saves the securities it does not have yet within a DB
 * transaction. A security that already exists is never modified.
 */
export const createMissingSecurities = withTransaction(createMissingSecuritiesImpl);
