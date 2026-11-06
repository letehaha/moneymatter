import { recordId } from '@common/lib/zod/custom-types';
import { updatePortfolioBodySchema, updatePortfolioBodyShape } from '@controllers/investments/portfolios/schemas';
import { updatePortfolio } from '@services/investments/portfolios/update.service';

import { defineTool } from '../define-tool';

export const updatePortfolioTool = defineTool({
  name: 'update_portfolio',
  toolset: 'investments',
  access: 'write',
  description:
    "Update an existing portfolio's name, type, description, or enabled state. Use when the user wants to rename, recategorize, or disable one of their portfolios. Obtain the portfolioId from get_portfolios first. Only the fields provided are changed.",
  input: {
    portfolioId: recordId().describe('Portfolio ID (from get_portfolios)'),
    name: updatePortfolioBodyShape.name.describe('New portfolio name (must be unique for this user), 1-255 characters'),
    portfolioType: updatePortfolioBodyShape.portfolioType.describe(
      'New portfolio type: investment, retirement, savings, or other',
    ),
    description: updatePortfolioBodyShape.description.describe('New description (pass null to clear)'),
    isEnabled: updatePortfolioBodyShape.isEnabled.describe('Enable or disable the portfolio'),
    displayCurrencyCode: updatePortfolioBodyShape.displayCurrencyCode.describe(
      'New display currency (ISO code, must be one of the user currencies); null = use base currency, omit = keep',
    ),
  },
  run: ({ userId, args }) => {
    // The either-or rule (at least one field) spans fields, so it runs on the REST body schema.
    const { portfolioId, ...fields } = args;
    const body = updatePortfolioBodySchema.parse(fields);

    return updatePortfolio({ userId, portfolioId, ...body });
  },
});
