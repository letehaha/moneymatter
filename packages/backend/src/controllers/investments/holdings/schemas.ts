import { ASSET_CLASS, SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** A search hit as `POST /investments/holding` takes it; `search_securities` returns items that satisfy it. */
export const SecuritySearchResultSchema = z.object({
  symbol: z.string(),
  providerSymbol: z.string(),
  priceSourceSymbol: z.string().trim().min(1).max(255).optional(),
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

/** Body of `POST /investments/holding`: a portfolio plus exactly one of an existing security and a search hit. */
export const createHoldingBodySchema = z
  .object({
    portfolioId: recordId(),
  })
  .and(
    z.union([
      z.object({ securityId: recordId(), searchResult: z.undefined() }),
      z.object({ securityId: z.undefined(), searchResult: SecuritySearchResultSchema }),
    ]),
  );

/** Body of `DELETE /investments/holding`; the MCP `delete_holding` tool reads its shape. */
export const deleteHoldingBodySchema = z.object({
  portfolioId: recordId(),
  securityId: recordId(),
  force: z.boolean().optional(),
});
