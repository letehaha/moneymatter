import type { RecordId } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { serializeTransactions } from '@root/serializers/transactions.serializer';

import { withTransaction } from '../common/with-transaction';
import { getTransactionById } from './get-by-id';

const MAX_IDS = 50;

interface GetTransactionsByIdsParams {
  userId: number;
  ids: RecordId[];
}

/**
 * Reads the requested transactions in the order given. Each id goes through the same
 * share-aware check as `GET /transactions/:id`, so what the caller gets follows their
 * current access to the parent account, not who authored the row. An id the caller cannot
 * see is left out.
 */
export const getTransactionsByIds = withTransaction(async ({ userId, ids }: GetTransactionsByIdsParams) => {
  if (ids.length > MAX_IDS) {
    throw new ValidationError({
      message: `Cannot fetch more than ${MAX_IDS} transactions at once`,
    });
  }

  if (ids.length === 0) {
    return [];
  }

  const fetched = await Promise.all([...new Set(ids)].map((id) => getTransactionById({ id, userId })));

  return serializeTransactions(fetched.flatMap((result) => (result ? [result.tx] : [])));
});
