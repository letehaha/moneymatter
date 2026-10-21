import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { dateString, isoCurrencyCode, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Body of `POST /investments/portfolios/:id/transfer`; the MCP `transfer_between_portfolios` tool reads its shape. */
export const portfolioTransferBodySchema = z.object({
  toPortfolioId: recordId(),
  currencyCode: isoCurrencyCode(),
  amount: positiveAmountString(),
  date: dateString(),
  description: z.string().nullable().optional(),
});

/** Body of `POST /investments/portfolios/:id/exchange-currency`; the MCP `exchange_portfolio_currency` tool reads its shape. */
export const exchangeCurrencyBodySchema = z.object({
  fromCurrencyCode: isoCurrencyCode(),
  toCurrencyCode: isoCurrencyCode(),
  fromAmount: positiveAmountString(),
  toAmount: positiveAmountString(),
  date: dateString(),
  description: z.string().nullable().optional(),
});

/** Body of `PATCH /investments/portfolios/:id/transfers/:transferId/adjustment`; read by `set_portfolio_transfer_adjustment`. */
export const transferAdjustmentBodySchema = z.object({
  isAdjustment: z.boolean(),
});

/** Fields of `POST /investments/portfolios`; the MCP `create_portfolio` tool reads its shape. */
export const createPortfolioBodyShape = {
  name: z.string().min(1, 'Portfolio name is required').max(100, 'Portfolio name must be 100 characters or less'),
  portfolioType: z.nativeEnum(PORTFOLIO_TYPE).default(PORTFOLIO_TYPE.investment),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  displayCurrencyCode: isoCurrencyCode().nullable().optional(),
  isEnabled: z.boolean().default(true),
};

/** Fields of `PATCH /investments/portfolios/:id`; the MCP `update_portfolio` tool reads its shape. */
export const updatePortfolioBodyShape = {
  name: z.string().min(1).max(255).optional(),
  portfolioType: z.nativeEnum(PORTFOLIO_TYPE).optional(),
  description: z.string().nullable().optional(),
  displayCurrencyCode: isoCurrencyCode().nullable().optional(),
  isEnabled: z.boolean().optional(),
};

export const updatePortfolioBodySchema = z
  .object(updatePortfolioBodyShape)
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });
