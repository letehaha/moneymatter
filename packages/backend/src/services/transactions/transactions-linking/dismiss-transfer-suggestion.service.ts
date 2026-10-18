import type { RecordId } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import * as Transactions from '@models/transactions.model';
import { createDismissal } from '@models/transfer-suggestion-dismissals.model';

/**
 * Remembers that a suggested expense/income pair is not a transfer, so scans stop offering it.
 * Both transactions must belong to the user. Dismissing the same pair twice is harmless.
 */
export async function dismissTransferSuggestion({
  userId,
  expenseTransactionId,
  incomeTransactionId,
}: {
  userId: number;
  expenseTransactionId: RecordId;
  incomeTransactionId: RecordId;
}): Promise<void> {
  // Verify both transactions belong to the authenticated user
  const transactions = await Transactions.getTransactionsByArrayOfField({
    userId,
    fieldName: 'id',
    fieldValues: [expenseTransactionId, incomeTransactionId],
  });

  if (transactions.length !== 2) {
    throw new ValidationError({
      message: 'One or both transactions not found',
    });
  }

  await createDismissal({ userId, expenseTransactionId, incomeTransactionId });
}
