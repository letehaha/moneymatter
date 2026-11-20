import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { exchangeCurrency } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { exchangeCurrencyBodySchema } from './schemas';
import { serializeTransferResponse } from './serialize-transfer';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: exchangeCurrencyBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const transfer = await exchangeCurrency({
    userId: user.id,
    portfolioId: params.id,
    fromCurrencyCode: body.fromCurrencyCode,
    toCurrencyCode: body.toCurrencyCode,
    fromAmount: body.fromAmount,
    toAmount: body.toAmount,
    date: body.date,
    description: body.description || null,
  });

  return { data: serializeTransferResponse({ transfer }) };
});
