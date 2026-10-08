import { API_RESPONSE_STATUS, type LinkTransactionsBody } from '@bt/shared/types';
import { CustomResponse } from '@common/types';
import { errorHandler } from '@controllers/helpers';
import { ValidationError } from '@js/errors';
import { serializeTransaction } from '@root/serializers';
import * as transactionsService from '@services/transactions';

export const linkTransactions = async (req, res: CustomResponse) => {
  try {
    const { ids }: LinkTransactionsBody = req.body;
    const { id: userId } = req.user;

    if (!ids || !Array.isArray(ids)) {
      throw new ValidationError({
        message: '"ids" field is missing or invalid.',
      });
    }

    const linkedPairs = await transactionsService.linkTransactions({
      userId,
      ids,
    });

    // Serialize: convert cents to decimal for API response
    // Result is [[baseTx, oppositeTx], ...] - serialize each transaction in each pair
    const serializedData = linkedPairs.map(([baseTx, oppositeTx]) => [
      serializeTransaction(baseTx),
      serializeTransaction(oppositeTx),
    ]);

    return res.status(200).json({ status: API_RESPONSE_STATUS.success, response: serializedData });
  } catch (err) {
    errorHandler(res, err as Error);
  }
};
