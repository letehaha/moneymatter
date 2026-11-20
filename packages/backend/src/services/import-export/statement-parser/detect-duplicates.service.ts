import type { ExtractedTransaction, StatementDuplicateMatch } from '@bt/shared/types';
import { detectDuplicates as genericDetectDuplicates } from '@root/services/transactions/duplicates-detection/detect-duplicates.service';

interface DetectDuplicatesParams {
  userId: number;
  accountId: string;
  transactions: ExtractedTransaction[];
}

/**
 * Detect duplicate transactions for statement import.
 *
 * Extracted amounts are decimals (same format execute-import accepts), and so is the generic
 * matcher's input and output, which rounds them to the account currency's decimals itself.
 */
export async function detectDuplicates({
  userId,
  accountId,
  transactions,
}: DetectDuplicatesParams): Promise<StatementDuplicateMatch[]> {
  const duplicates = await genericDetectDuplicates({ userId, accountId, transactions });

  return duplicates.map((d) => ({
    transactionIndex: d.index,
    extractedTransaction: transactions[d.index]!,
    existingTransaction: d.existing,
  }));
}
