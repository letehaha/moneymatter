import type { TransactionGroupResponse } from '@/api/transaction-groups';
import { parseISO } from 'date-fns';

export type GroupSortField = 'date' | 'name' | 'amount';
export type GroupSortDirection = 'asc' | 'desc';

export const DEFAULT_SORT_DIRECTION: Record<GroupSortField, GroupSortDirection> = {
  date: 'desc',
  name: 'asc',
  amount: 'desc',
};

const groupTime = ({ group }: { group: TransactionGroupResponse }) =>
  parseISO(group.dateTo ?? group.dateFrom ?? group.createdAt).getTime();

const compareBy: Record<GroupSortField, (a: TransactionGroupResponse, b: TransactionGroupResponse) => number> = {
  date: (a, b) => groupTime({ group: a }) - groupTime({ group: b }),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  amount: (a, b) => (a.netRefAmount ?? 0) - (b.netRefAmount ?? 0),
};

export const sortGroups = ({
  groups,
  field,
  direction,
}: {
  groups: TransactionGroupResponse[];
  field: GroupSortField;
  direction: GroupSortDirection;
}) => {
  const sign = direction === 'asc' ? 1 : -1;
  return [...groups].sort((a, b) => sign * compareBy[field](a, b));
};
