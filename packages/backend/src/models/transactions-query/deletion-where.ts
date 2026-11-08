import { TRANSACTION_DELETION_REASON } from '@bt/shared/types';

export const trashedWhere = { deletionReason: TRANSACTION_DELETION_REASON.trash } as const;
export const reconciliationRemovedWhere = { deletionReason: TRANSACTION_DELETION_REASON.reconciliation } as const;

export const liveTransactionExistsSql = ({ idColumnSql }: { idColumnSql: string }) =>
  `EXISTS (SELECT 1 FROM "Transactions" lt WHERE lt.id = ${idColumnSql} AND lt."deletedAt" IS NULL)`;

export const liveOrExternalTransactionSql = ({ idColumnSql }: { idColumnSql: string }) =>
  `(${idColumnSql} IS NULL OR ${liveTransactionExistsSql({ idColumnSql })})`;
