import { dateString, isoCurrencyCode, positiveAmountString, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { portfolioToAccountTransfer } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { serializeTransferResponse } from './serialize-transfer';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: z.object({
    accountId: recordId(),
    amount: positiveAmountString(),
    currencyCode: isoCurrencyCode(),
    date: dateString(),
    description: z.string().nullable().optional(),
    existingTransactionId: recordId().optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const transfer = await portfolioToAccountTransfer({
    userId: user.id,
    portfolioId: params.id,
    accountId: body.accountId,
    amount: body.amount,
    currencyCode: body.currencyCode,
    date: body.date,
    description: body.description || null,
    existingTransactionId: body.existingTransactionId,
  });

  return { data: serializeTransferResponse({ transfer }) };
});
