import type { Money } from '@common/types/money';
import type Transactions from '@models/transactions.model';
import type { TransactionGroupResult } from '@services/transaction-groups/get-transaction-groups';

import { serializeTransaction, TransactionApiResponse } from './transactions.serializer';

export interface TransactionGroupApiResponse {
  id: string;
  name: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  transactionCount?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  netRefAmount?: number;
  transactions?: TransactionApiResponse[];
}

interface TransactionGroupInput {
  id: string;
  name: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  transactions?: Transactions[];
  transactionCount?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  netRefAmount?: Money;
}

export function serializeTransactionGroup(group: TransactionGroupInput): TransactionGroupApiResponse {
  return {
    id: group.id,
    name: group.name,
    note: group.note,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    ...(group.transactionCount !== undefined && { transactionCount: group.transactionCount }),
    ...(group.dateFrom !== undefined && { dateFrom: group.dateFrom }),
    ...(group.dateTo !== undefined && { dateTo: group.dateTo }),
    ...(group.netRefAmount !== undefined && { netRefAmount: group.netRefAmount.toNumber() }),
    ...(group.transactions && {
      transactions: group.transactions.map(serializeTransaction),
    }),
  };
}

export function serializeTransactionGroups(groups: TransactionGroupResult): TransactionGroupApiResponse[] {
  return groups.map(serializeTransactionGroup);
}
