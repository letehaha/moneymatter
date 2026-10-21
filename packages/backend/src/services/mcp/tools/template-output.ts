import type { TransactionTemplateModel } from '@bt/shared/types';

/**
 * A transaction template as an assistant reads it: the preset fields and tag ids, without the
 * owner id and timestamps.
 */
export function presentTemplate({ template }: { template: TransactionTemplateModel }) {
  return {
    id: template.id,
    name: template.name,
    transactionType: template.transactionType,
    amount: template.amount,
    accountId: template.accountId,
    categoryId: template.categoryId,
    payeeId: template.payeeId,
    paymentType: template.paymentType,
    note: template.note,
    originalCurrencyCode: template.originalCurrencyCode,
    tagIds: template.tagIds,
  };
}
