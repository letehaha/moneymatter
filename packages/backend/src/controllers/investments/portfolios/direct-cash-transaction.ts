import { dateString, isoCurrencyCode, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { directCashTransaction } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { serializeTransferResponse } from './serialize-transfer';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: z.object({
    type: z.enum(['deposit', 'withdrawal']),
    amount: positiveAmountString(),
    currencyCode: isoCurrencyCode(),
    date: dateString(),
    description: z.string().nullable().optional(),
    isAdjustment: z.boolean().optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const transfer = await directCashTransaction({
    userId: user.id,
    portfolioId: params.id,
    type: body.type,
    amount: body.amount,
    currencyCode: body.currencyCode,
    date: body.date,
    description: body.description || null,
    isAdjustment: body.isAdjustment ?? false,
  });

  return { data: serializeTransferResponse({ transfer }) };
});
