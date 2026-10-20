import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { isoCurrencyCode, numericString, recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

// Accept a date-only value ("2026-06-20") or a full ISO 8601 datetime ("2026-06-20T09:00:00.000Z").
// Date-only is normalized to UTC midnight.
const investmentTransactionDate = z.union([z.string().date(), z.string().datetime({ offset: true })]);

const positiveNumberString = ({ message }: { message: string }) =>
  z
    .string()
    .optional()
    .refine((val) => val === undefined || (!isNaN(parseFloat(val)) && parseFloat(val) > 0), { message });

const nonNegativeNumberString = ({ message }: { message: string }) =>
  z
    .string()
    .optional()
    .refine((val) => val === undefined || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), { message });

/**
 * Fields of `POST /investments/transactions`; the MCP `create_investment_transaction` tool reads its
 * shape. The settlement leg is the actual cash side of the trade when it differs from the security's
 * currency, or when only the total cash moved is known and the fee is derived. Whether
 * settlementFees is required depends on the holding's currency, so that check lives in the service.
 */
export const createInvestmentTransactionBodyShape = {
  portfolioId: recordId(),
  securityId: recordId(),
  category: z.nativeEnum(INVESTMENT_TRANSACTION_CATEGORY),
  date: investmentTransactionDate,
  quantity: numericString(),
  // Zero price = legitimate position change with no cash consideration (staking, airdrops, balance
  // adjustments, burns). The category (buy/sell) tells us direction.
  price: numericString({ allowZero: true }),
  fees: numericString({ allowZero: true }).optional().default('0'),
  name: z.string().optional(),
  settlementCurrencyCode: isoCurrencyCode().optional(),
  settlementAmount: numericString({ allowZero: true }).optional(),
  settlementFees: numericString({ allowZero: true }).optional(),
  // Known security→settlement rate; the fee is derived as the residual. Omitting both this and
  // settlementFees makes the service fall back to the market rate for the trade date.
  settlementRate: numericString().optional(),
};

/** The body of `POST /investments/transactions`: the shape plus the cross-field rules of the settlement leg. */
export const createInvestmentTransactionBodySchema = z
  .object(createInvestmentTransactionBodyShape)
  .refine((body) => body.settlementCurrencyCode === undefined || body.settlementAmount !== undefined, {
    message: 'settlementAmount is required when settlementCurrencyCode is provided.',
  })
  .refine((body) => body.settlementAmount === undefined || body.settlementCurrencyCode !== undefined, {
    message: 'settlementCurrencyCode is required when settlementAmount is provided.',
  })
  .refine((body) => body.settlementRate === undefined || body.settlementCurrencyCode !== undefined, {
    message: 'settlementCurrencyCode is required when settlementRate is provided.',
  })
  .refine((body) => body.settlementFees === undefined || body.settlementRate === undefined, {
    message: 'Provide either settlementFees or settlementRate, not both.',
  });

/**
 * Fields of `PATCH /investments/transactions/:transactionId`; the MCP `update_investment_transaction`
 * tool reads its shape. The settlement rules depend on the stored transaction and the holding's
 * currency, so they live in the service.
 */
export const updateInvestmentTransactionBodyShape = {
  category: z.nativeEnum(INVESTMENT_TRANSACTION_CATEGORY).optional(),
  date: investmentTransactionDate.optional(),
  quantity: positiveNumberString({ message: 'Quantity must be a positive number' }),
  // Zero allowed: staking rewards / airdrops / burns / balance adjustments are real position changes
  // with no cash side.
  price: nonNegativeNumberString({ message: 'Price must be a non-negative number' }),
  fees: nonNegativeNumberString({ message: 'Fees must be a non-negative number' }),
  name: z.string().optional(),
  settlementCurrencyCode: isoCurrencyCode().optional(),
  settlementAmount: numericString({ allowZero: true }).optional(),
  settlementFees: numericString({ allowZero: true }).optional(),
  settlementRate: numericString().optional(),
};
