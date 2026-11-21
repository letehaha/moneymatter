import { createController } from '@controllers/helpers/controller-factory';
import { deserializeCreateTransaction, serializeTransactionTuple } from '@root/serializers';
import { attachTransactionCurrencyMeta } from '@services/currencies/effective-currency';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import { createTransactionBodySchema } from './schemas';

const schema = z.object({
  body: createTransactionBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;

  // Deserialize: API decimals to Money amounts
  const params = deserializeCreateTransaction(body, userId);

  // TODO: Add validations
  // 1. Amount and destinationAmount with same currency should be equal

  const transactions = await transactionsService.createTransaction(params);
  await attachTransactionCurrencyMeta({ transactions });

  // Serialize: Money amounts to API decimals
  // createTransaction returns [baseTx, oppositeTx?] tuple
  return { data: serializeTransactionTuple(transactions) };
});
