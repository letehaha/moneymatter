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
