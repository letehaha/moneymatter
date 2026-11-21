import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import { type AccountModel, isDedicatedFlowAccountCategory } from '@bt/shared/types';
import {
  addMonths,
  differenceInCalendarMonths,
  endOfMonth,
  isAfter,
  isFirstDayOfMonth,
  startOfMonth,
  subMonths,
} from 'date-fns';

const RUNWAY_WINDOW_MONTHS = 6;

export const isCashAccount = ({
  account,
}: {
  account: Pick<AccountModel, 'excludeFromStats' | 'accountCategory'>;
}): boolean => !account.excludeFromStats && !isDedicatedFlowAccountCategory(account.accountCategory);

/**
 * The last {@link RUNWAY_WINDOW_MONTHS} full calendar months, shortened to the user's history.
 * A partial first month would understate monthly spend, so history starting mid-month
 * only counts from the next month. Null when there isn't a single full month yet.
 */
export const computeRunwayWindow = ({
  now,
  earliestDate,
}: {
  now: Date;
  earliestDate: Date | undefined;
}): { from: Date; to: Date; months: number } | null => {
  if (!earliestDate) return null;

  const to = endOfMonth(subMonths(now, 1));
  const fullWindowFrom = startOfMonth(subMonths(now, RUNWAY_WINDOW_MONTHS));
  const historyFrom = isFirstDayOfMonth(earliestDate)
    ? startOfMonth(earliestDate)
    : startOfMonth(addMonths(earliestDate, 1));
  const from = isAfter(historyFrom, fullWindowFrom) ? historyFrom : fullWindowFrom;
  const months = differenceInCalendarMonths(to, from) + 1;

  return months > 0 ? { from, to, months } : null;
};

/** Months the cash would last at the average monthly spend, to one decimal. Null when there's no spend to divide by. */
export const computeRunwayMonths = ({
  totalCash,
  totalExpenses,
  months,
}: {
  totalCash: number;
  totalExpenses: number;
  months: number;
}): number | null => {
  const monthlySpend = totalExpenses / months;
  if (monthlySpend <= 0) return null;
  return Math.round((Math.max(totalCash, 0) / monthlySpend) * 10) / 10;
};

/** Base-currency total of the given accounts from a single-day balance-history response, net of the current credit limit when the setting is on. */
export const sumBalancesOnDate = ({
  rows,
  accounts,
  includeCreditLimit,
}: {
  rows: { accountId: string; amount: number }[];
  accounts: { id: string; creditLimit: number; refCreditLimit: number }[];
  includeCreditLimit: boolean;
}): number => {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return rows.reduce((total, row) => {
    const account = accountsById.get(row.accountId);
    if (!account) return total;

    return (
      total +
      computeAccountDisplayBalances({
        currentBalance: row.amount,
        refCurrentBalance: row.amount,
        creditLimit: account.creditLimit,
        refCreditLimit: account.refCreditLimit,
        includeCreditLimit,
      }).displayRefBalance
    );
  }, 0);
};
