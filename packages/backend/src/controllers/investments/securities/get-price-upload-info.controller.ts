import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPriceUploadInfo } from '@root/services/investments/securities-price/get-price-upload-info.service';
import { z } from 'zod';

/**
 * POST /api/v1/investments/securities/price-upload-info
 *
 * Returns information about available date range for uploading security prices.
 * Accepts a currency code directly (from SecuritySearchResult).
 * Admin-only endpoint.
 *
 * Returns:
 * - oldestDate: Oldest date with exchange rates available for security's currency
 * - newestDate: Newest date with exchange rates available for security's currency
 * - currencyCode: Security's currency code
 * - minAllowedDate: Minimum allowed date (2000-01-01)
 */
export default createController(
  z.object({
    body: z.object({
      currencyCode: isoCurrencyCode(),
    }),
  }),
  async ({ body }) => {
    const result = await getPriceUploadInfo(body);

    return {
      data: result,
    };
  },
);
