import { createController } from '@controllers/helpers/controller-factory';
import { deserializeCreateTransaction, serializeTransactionTuple } from '@root/serializers';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import { createTransactionBodySchema } from './schemas';

const schema = z.object({
  body: createTransactionBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;

  // Deserialize: convert decimal amounts to cents
  const params = deserializeCreateTransaction(body, userId);

  // TODO: Add validations
  // 1. Amount and destinationAmount with same currency should be equal

  const transactions = await transactionsService.createTransaction(params);

  // Serialize: convert cents to decimal for API response
  // createTransaction returns [baseTx, oppositeTx?] tuple
  return { data: serializeTransactionTuple(transactions) };
});
