import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createPortfolioTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { portfolioTransferBodySchema } from './schemas';
import { serializeTransferResponse } from './serialize-transfer';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: portfolioTransferBodySchema,
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
