import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { isoCurrencyCode, numericString, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { z } from 'zod';

export default createController(
  z.object({
    body: z
      .object({
        portfolioId: recordId(),
        securityId: recordId(),
        category: z.nativeEnum(INVESTMENT_TRANSACTION_CATEGORY),
        // Accept a date-only value ("2026-06-20") or a full ISO 8601 datetime
        // ("2026-06-20T09:00:00.000Z"). Date-only is normalized to UTC midnight.
        date: z.union([z.string().date(), z.string().datetime({ offset: true })]),
        quantity: numericString(),
        // Zero price = legitimate position change with no cash consideration
        // (staking, airdrops, balance adjustments, burns). The category (buy/sell)
        // tells us direction; price=0 records that no cash crossed the boundary.
        price: numericString({ allowZero: true }),
        fees: numericString({ allowZero: true }).optional().default('0'),
        name: z.string().optional(),
        // Settlement leg: the actual cash side of the trade when it differs
        // from the security's currency, or when the user only knows the total
        // cash moved and wants the fee derived. Whether settlementFees is
        // required depends on the holding's currency, so that check lives in
        // the service (resolveSettlement).
        settlementCurrencyCode: isoCurrencyCode().optional(),
        settlementAmount: numericString({ allowZero: true }).optional(),
        settlementFees: numericString({ allowZero: true }).optional(),
        // Known security→settlement rate; the fee is derived as the residual.
        // Omitting both this and settlementFees makes the service fall back to
        // the market rate for the trade date.
        settlementRate: numericString().optional(),
      })
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
      }),
  }),
  async ({ user, body }) => {
    const tx = await createInvestmentTransaction({ userId: user.id, ...body });
    return { data: tx, statusCode: 201 };
  },
);
