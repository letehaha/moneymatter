import { SUPPORTED_ASSET_CLASSES, type SecuritySearchResult } from '@bt/shared/types/investments';
import { ValidationError } from '@js/errors';
import { createHolding } from '@services/investments/holdings/create-holding.service';
import { addSecurityFromSearch } from '@services/investments/securities/add-from-search.service';

interface CreateHoldingFromInputParams {
  userId: number;
  portfolioId: string;
  /** An existing security. Exactly one of this and `searchResult` is set. */
  securityId?: string;
  /** A hit from the securities search: the security is created from it first. */
  searchResult?: SecuritySearchResult;
}

/**
 * Adds a security to a portfolio. With a `searchResult` the security is created (or matched to the
 * row that already stands for it) first, after the asset class is checked; with a `securityId` it
 * must already exist. Shared by `POST /investments/holding` and the MCP `create_holding` tool.
 */
export const createHoldingFromInput = async ({
  userId,
  portfolioId,
  securityId,
  searchResult,
}: CreateHoldingFromInputParams) => {
  let finalSecurityId = securityId;

  if (searchResult) {
    if (!SUPPORTED_ASSET_CLASSES.includes(searchResult.assetClass)) {
      throw new ValidationError({
        message: `Asset class "${searchResult.assetClass}" is not supported yet.`,
      });
    }

    const { security } = await addSecurityFromSearch({ searchResult });
    finalSecurityId = security.id;
  }

  if (!finalSecurityId) {
    throw new Error('No securityId available after processing request');
  }

  return createHolding({ userId, portfolioId, securityId: finalSecurityId });
};
