import { Money } from '@common/types/money';

/**
 * Fields whose values feed account-balance and Balances-table recomputation.
 * Everything else on a transaction (note, category, payee, tags, timestamps)
 * leaves every balance untouched.
 *
 * Values are typed `unknown` because callers pass raw Sequelize `dataValues` /
 * `_previousDataValues`, where money columns are still decimal strings (or numbers
 * from a hand-built snapshot) and dates may arrive as strings — not the types the
 * model declares.
 */
export interface BalanceRelevantSnapshot {
  accountId?: unknown;
  accountType?: unknown;
  amount?: unknown;
  refAmount?: unknown;
  time?: unknown;
  transactionType?: unknown;
  currencyCode?: unknown;
  refCurrencyCode?: unknown;
  transferNature?: unknown;
  externalData?: unknown;
  isPlanned?: unknown;
}

const MONEY_FIELDS = ['amount', 'refAmount'] as const satisfies readonly (keyof BalanceRelevantSnapshot)[];

const PRIMITIVE_FIELDS = [
  'accountId',
  'accountType',
  'transactionType',
  'currencyCode',
  'refCurrencyCode',
  'transferNature',
  'isPlanned',
] as const satisfies readonly (keyof BalanceRelevantSnapshot)[];

/** Compares by value, so `"12.5"` and `"12.500000000000000000"` are the same amount. */
const isSameMoney = ({ next, prev }: { next: unknown; prev: unknown }): boolean => {
  const isScalar = (value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number';

  if (isScalar(next) && isScalar(prev)) return Money.fromDecimal(next).equals(Money.fromDecimal(prev));

  return next === prev;
};

const toTimeKey = (value: unknown): unknown => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value ?? null;
};

const isSameJsonBlob = ({ next, prev }: { next: unknown; prev: unknown }): boolean => {
  if (next === prev) return true;
  if (next == null || prev == null) return next == null && prev == null;
  return JSON.stringify(next) === JSON.stringify(prev);
};

export const hasBalanceRelevantChange = ({
  next,
  prev,
}: {
  next: BalanceRelevantSnapshot;
  prev: BalanceRelevantSnapshot;
}): boolean => {
  for (const field of PRIMITIVE_FIELDS) {
    if (next[field] !== prev[field]) return true;
  }

  for (const field of MONEY_FIELDS) {
    if (!isSameMoney({ next: next[field], prev: prev[field] })) return true;
  }

  if (toTimeKey(next.time) !== toTimeKey(prev.time)) return true;

  return !isSameJsonBlob({ next: next.externalData, prev: prev.externalData });
};
