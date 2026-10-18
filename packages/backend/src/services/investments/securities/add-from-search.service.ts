import { type SecuritySearchResult } from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { withTransaction } from '@services/common/with-transaction';

import { dataProviderFactory } from '../data-providers';
import { toProviderSymbol } from '../data-providers/base-provider';
import { createMissingSecurities } from '../securities-manage';
import { findSecurityByIdentity } from './identity';

interface AddSecurityFromSearchParams {
  searchResult: SecuritySearchResult;
  /**
   * When user is uploading prices manually, we don't need to try fetch prices
   */
  skipPriceFetch?: boolean;
}

interface AddSecurityFromSearchResult {
  security: typeof Securities.prototype;
  latestPrice?: {
    price: number;
    date: Date;
  };
}

const addSecurityFromSearchImpl = async ({
  searchResult,
  skipPriceFetch = false,
}: AddSecurityFromSearchParams): Promise<AddSecurityFromSearchResult> => {
  logger.info(`Adding security from search: ${searchResult.symbol} - ${searchResult.name}`);

  // Step 1: Create the security when it does not exist yet. An existing row is left as stored.
  await createMissingSecurities({ securities: [searchResult] });

  // Step 2: Resolve the created or existing row via the shared identity helper –
  // the same key shape `createMissingSecurities` used for dedup. A non-crypto
  // search result whose existing row was sourced from a different provider
  // (e.g. an FMP-sourced VOO matched against a Yahoo hit) resolves to that
  // existing row instead of looking like a fresh insert.
  const security = await findSecurityByIdentity(searchResult);

  if (!security) {
    throw new Error(
      `Failed to create/find security with providerSymbol: ${searchResult.providerSymbol} (provider: ${searchResult.providerName})`,
    );
  }

  // Step 3: Fetch and store the latest price immediately (unless skipped)
  let latestPrice: AddSecurityFromSearchResult['latestPrice'];

  // Provider and symbol come from the stored row, never the request: the price lands on a row
  // every user shares.
  const priceQuerySymbol = security.priceQuerySymbol;

  if (!skipPriceFetch) {
    try {
      const provider = dataProviderFactory.getProvider(security.providerName);
      // TODO: consider using composite provider here
      const priceData = await provider.getLatestPrice(toProviderSymbol(priceQuerySymbol));

      // Store the price in SecurityPricing table
      await SecurityPricing.create({
        securityId: security.id,
        date: priceData.date,
        priceClose: priceData.priceClose.toString(),
        source: provider.providerName,
      });

      latestPrice = {
        price: priceData.priceClose,
        date: priceData.date,
      };

      // Update the security's last price sync timestamp
      security.pricingLastSyncedAt = new Date();
      await security.save();

      logger.info(`Successfully fetched latest price for ${security.symbol}: ${priceData.priceClose}`);
    } catch (error) {
      // The immediate price fetch is optional and best-effort: the security was
      // created successfully and the daily price-sync cron backfills its price on
      // the next run. Any failure here (free-tier 402 paywalls on non-US tickers,
      // provider hiccups, unlisted symbols) is therefore self-healing and not
      // actionable — keep it visible in Loki via info, but never page Sentry.
      // Persistent provider breakage surfaces through the daily sync instead.
      const routedVia =
        priceQuerySymbol !== security.providerSymbol ? ` (routed via priceSourceSymbol=${priceQuerySymbol})` : '';
      logger.info(
        `Failed to fetch latest price for ${security.symbol}${routedVia} (will be backfilled by daily sync)`,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      // Don't throw - the security creation succeeded, price fetch is optional
    }
  }

  logger.info(`Successfully added security from search: ${security.symbol}`);

  return {
    security,
    latestPrice,
  };
};

/**
 * Adds a security to the database from search results and optionally fetches its latest price.
 * This is used when a user selects a security from search results to add to their portfolio.
 *
 * @param params - The search result selected by the user
 * @param params.skipPriceFetch - If true, skips fetching the latest price from external API
 * @returns The created or existing security with optional latest price info
 */
export const addSecurityFromSearch = withTransaction(addSecurityFromSearchImpl);
