import type { APIRequestContext } from '@playwright/test';

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  createAccount,
  createTransaction,
  extractId,
} from './api-client';

export type GoalShare =
  | { accountId: string; sharePercent: number }
  | { accountId: string; fixedAmount: number; fixedPosition?: number };
export type GoalLink = {
  accountId: string;
  sharePercent: number | null;
  fixedAmount: number | null;
  fixedPosition: number | null;
};
export type GoalStatus = 'active' | 'paused' | 'archived';

type GoalFields = {
  name: string;
  targetAmount: number;
  currencyCode: string;
  targetDate?: string | null;
  plannedMonthly?: number | null;
  reachedHoldDays?: number;
  accounts: GoalShare[];
};

export type Goal = Omit<GoalFields, 'accounts' | 'reachedHoldDays'> & {
  id: string;
  accounts: GoalLink[];
  reachedHoldDays: number;
  status: GoalStatus;
  achievedAt: string | null;
  achievedAmount: number | null;
  insights: Record<string, unknown> | null;
};

const unwrap = <T>(result: { response?: T } & T): T => result.response ?? result;

export async function createGoal({ request, ...payload }: GoalFields & { request: APIRequestContext }): Promise<Goal> {
  return unwrap(await apiPost({ request, path: '/api/v1/goals', data: payload }));
}

/** `accounts`, when sent, replaces the whole share set. */
export async function updateGoal({
  request,
  goalId,
  ...payload
}: Partial<GoalFields> & { request: APIRequestContext; goalId: string; status?: GoalStatus }): Promise<Goal> {
  return unwrap(await apiPatch({ request, path: `/api/v1/goals/${goalId}`, data: payload }));
}

export async function deleteGoal({ request, goalId }: { request: APIRequestContext; goalId: string }) {
  return apiDelete({ request, path: `/api/v1/goals/${goalId}` });
}

export async function listGoals({ request }: { request: APIRequestContext }): Promise<Goal[]> {
  return unwrap(await apiGet({ request, path: '/api/v1/goals' }));
}

export const ACCOUNT_CATEGORY = {
  general: 'general',
  cash: 'cash',
  currentAccount: 'current-account',
  creditCard: 'credit-card',
  saving: 'saving',
  investment: 'investment',
  crypto: 'crypto',
} as const;

export async function createAccountOfCategory({
  request,
  name,
  currencyCode,
  initialBalance,
  category,
  creditLimit = 0,
}: {
  request: APIRequestContext;
  name: string;
  currencyCode: string;
  initialBalance: number;
  category: (typeof ACCOUNT_CATEGORY)[keyof typeof ACCOUNT_CATEGORY];
  creditLimit?: number;
}): Promise<string> {
  return extractId(
    await createAccount({ request, name, currencyCode, initialBalance, accountCategory: category, creditLimit }),
  );
}

export async function archiveAccount({ request, accountId }: { request: APIRequestContext; accountId: string }) {
  return apiPut({ request, path: `/api/v1/accounts/${accountId}`, data: { status: 'archived' } });
}

export async function deleteAccount({ request, accountId }: { request: APIRequestContext; accountId: string }) {
  return apiDelete({ request, path: `/api/v1/accounts/${accountId}` });
}

/** Noon UTC on the 15th of the month `monthsAgo` before now, or now itself for the current month. */
export function monthsAgoIso({ monthsAgo }: { monthsAgo: number }): string {
  const now = new Date();
  if (monthsAgo === 0) return now.toISOString();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 15, 12)).toISOString();
}

/**
 * `amountsOldestFirst[i]` lands in the month `newestMonthsAgo + (length - 1 - i)` ago, so the last entry is
 * `newestMonthsAgo` months ago. Positive = income, negative = expense, 0 = no transaction.
 */
export async function seedMonthlyDeposits({
  request,
  accountId,
  amountsOldestFirst,
  newestMonthsAgo = 1,
}: {
  request: APIRequestContext;
  accountId: string;
  amountsOldestFirst: number[];
  newestMonthsAgo?: number;
}): Promise<void> {
  for (const [i, amount] of amountsOldestFirst.entries()) {
    if (amount === 0) continue;
    await createTransaction({
      request,
      accountId,
      amount: Math.abs(amount),
      transactionType: amount > 0 ? 'income' : 'expense',
      time: monthsAgoIso({ monthsAgo: newestMonthsAgo + amountsOldestFirst.length - 1 - i }),
    });
  }
}

/** Pins `currencyCode → baseCurrencyCode` and disables live rates for it; the currency must already be added. */
export async function setCustomRate({
  request,
  currencyCode,
  baseCurrencyCode,
  rate,
}: {
  request: APIRequestContext;
  currencyCode: string;
  baseCurrencyCode: string;
  rate: number;
}) {
  return apiPut({
    request,
    path: '/api/v1/user/currency/rates',
    data: {
      pairs: [
        { baseCode: currencyCode, quoteCode: baseCurrencyCode, rate },
        { baseCode: baseCurrencyCode, quoteCode: currencyCode, rate: 1 / rate },
      ],
    },
  });
}
