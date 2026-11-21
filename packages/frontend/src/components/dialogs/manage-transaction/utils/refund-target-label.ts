import type { TransactionModel } from '@bt/shared/types';

export const getRefundTargetLabel = ({
  transaction,
  categoryId = transaction.categoryId,
  categoriesMap,
  unknownLabel,
}: {
  transaction: Pick<TransactionModel, 'note' | 'categoryId'>;
  /** Overrides the transaction's category, e.g. with the targeted split's one. */
  categoryId?: string;
  categoriesMap: Record<string, { name: string } | undefined>;
  unknownLabel: string;
}) => transaction.note || (categoriesMap[categoryId]?.name ?? unknownLabel);
