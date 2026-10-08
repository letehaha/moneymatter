import TransactionTags from '@models/transaction-tags.model';
import { DOMAIN_EVENTS, eventBus } from '@services/common/event-bus';

/**
 * Add-only tag merge for rule-driven tagging (payee / category defaults): existing tags on
 * the rows are never removed, duplicates are skipped via the `TransactionTags` composite PK.
 * Emits the same tagging event as the manual paths so tag reminders fire in real time.
 */
export async function addTagsToTransactions({
  userId,
  tagIds,
  transactionIds,
}: {
  userId: number;
  tagIds: string[];
  transactionIds: string[];
}): Promise<void> {
  if (tagIds.length === 0 || transactionIds.length === 0) return;
  await TransactionTags.bulkCreate(
    transactionIds.flatMap((transactionId) => tagIds.map((tagId) => ({ tagId, transactionId }))),
    { ignoreDuplicates: true },
  );
  eventBus.emit(DOMAIN_EVENTS.TRANSACTIONS_TAGGED, { tagIds, userId });
}
