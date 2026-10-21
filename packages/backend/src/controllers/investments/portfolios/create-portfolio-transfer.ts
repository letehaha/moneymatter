import { dateString, isoCurrencyCode, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createPortfolioTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { serializeTransferResponse } from './serialize-transfer';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: z.object({
    toPortfolioId: recordId(),
    currencyCode: isoCurrencyCode(),
    amount: positiveAmountString(),
    date: dateString(),
    description: z.string().nullable().optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const transfer = await createPortfolioTransfer({
    userId: user.id,
    fromPortfolioId: params.id,
    toPortfolioId: body.toPortfolioId,
    currencyCode: body.currencyCode,
    amount: body.amount,
    date: body.date,
    description: body.description || null,
  });

  return { data: serializeTransferResponse({ transfer }) };
});
