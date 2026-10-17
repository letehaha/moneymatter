import { ASSET_CLASS, SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { bulkUploadSecurityPrices } from '@root/services/investments/securities-price/bulk-upload-prices.service';
import { z } from 'zod';

// Zod schema for SecuritySearchResult
const SecuritySearchResultSchema = z.object({
  symbol: z.string(),
  providerSymbol: z.string(),
  name: z.string(),
  assetClass: z.nativeEnum(ASSET_CLASS),
  providerName: z.nativeEnum(SECURITY_PROVIDER),
  exchangeAcronym: z.string().optional(),
  exchangeMic: z.string().optional(),
  exchangeName: z.string().optional(),
  currencyCode: z.string(),
  cryptoCurrencyCode: z.string().optional(),
  cusip: z.string().optional(),
  isin: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
  matchType: z.enum(['exact', 'partial']).optional(),
  marketCapRank: z.number().nullable().optional(),
}) satisfies z.ZodType<SecuritySearchResult>;

// TODO:
// 1. When searching securities, somehow mark that their prices are not auto-uploaded
// and can only be uploaded and refreshed manually by admin. Check for security price and if it's "manual"
// 2. When doing bulk prices updating logs are a bit off – it says that securities were synced and etc.
// it's because addOrGet service is not aware where it just "returns" existing sercurity.
// If only "get" happens, it should't log "synced" logs
// 5. When "Too Large Payload" error happens, frontend should handle it gratefulyl
// 6. On frontend use `csv-parse` instead of manual parsing
// 7. e2e tests
// 8. Refactor all the code before commiting, cause many things should be reorganized
// and/or improved
// 9. Consider more edge cases like:
// 9.1 When user selects currency like USD, but tried to upload another currency. Can we warn about it?
// 9.2 When user wants to re-upload data for new dates, can we on frontend check that:
// 9.2.1 previous latest price value differs too much from a new one?
// 9.2.2 values from new dataset don't match existing values for the same dates (in case user selected wrong dataset accidentally)

/**
 * POST /api/v1/investments/securities/prices/bulk-upload
 *
 * Bulk upload security prices. Admin-only endpoint.
 * Accepts SecuritySearchResult to create/find the security.
 *
 * Body:
 * - searchResult: SecuritySearchResult
 * - prices: Array of { price, date, currency }
 * - autoFilter: boolean - if true, filter dates outside available exchange rate range
 * - override: boolean - if true, update existing records (upsert), else ignore duplicates
 *
 * Returns:
 * - newOldestDate: Oldest date in SecurityPricing after upload
 * - newNewestDate: Newest date in SecurityPricing after upload
 * - summary: { inserted, duplicates, filtered }
 */
export default createController(
  z.object({
    body: z.object({
      searchResult: SecuritySearchResultSchema,
      prices: z.array(
        z.object({
          price: z.number().positive().max(1e12), // Max 1 trillion (reasonable upper bound)
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          currency: isoCurrencyCode(),
        }),
      ),
      autoFilter: z.boolean().default(false),
      override: z.boolean().default(false),
    }),
  }),
  async ({ body }) => {
    const result = await bulkUploadSecurityPrices(body);

    return {
      data: result,
    };
  },
);
