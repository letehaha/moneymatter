import { isApiErrorWithCode } from '@/js/errors';
import { accountGoalValue, neededMonthly, roundShare } from '@bt/shared/goals/goal-math';
import {
  ACCOUNT_STATUSES,
  API_ERROR_CODES,
  type AccountModel,
  type CreateGoalPayload,
  GOAL_ELIGIBLE_ACCOUNT_CATEGORIES,
  type GoalAccountShare,
  type GoalModel,
  type GoalShareCapacityExceededDetails,
  type RecordId,
} from '@bt/shared/types';
import { format, parseISO } from 'date-fns';

import type { GoalWhatIfApplyValues } from './composables/use-goal-what-if';

export interface GoalFormState {
  name: string;
  currencyCode: string;
  targetAmount: number | null;
  targetDate: Date | null;
  hasPlannedMonthly: boolean;
  plannedMonthly: number | null;
  accounts: GoalAccountShare[];
}

export type GoalFormErrors = Record<
  'name' | 'targetAmount' | 'targetDate' | 'plannedMonthly' | 'accounts',
  string | null
>;

export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

/** Number input value; an empty field is null. */
export const parseNumberOrNull = (value: string | number | null) =>
  value === null || value === '' ? null : Number(value);

const isPositive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/** `initialValues` override the goal's planned monthly amount, target date and accounts. */
export const goalFormStateFrom = ({
  goal,
  initialValues,
  baseCurrencyCode,
}: {
  goal?: GoalModel;
  initialValues?: GoalWhatIfApplyValues | null;
  baseCurrencyCode: string;
}): GoalFormState => {
  const { plannedMonthly = null, targetDate = null, accounts = [] } = { ...goal, ...initialValues };
  const hasPlannedMonthly = isPositive(plannedMonthly);

  return {
    name: goal?.name ?? '',
    currencyCode: goal?.currencyCode ?? baseCurrencyCode,
    targetAmount: goal?.targetAmount ?? null,
    targetDate: targetDate ? parseISO(targetDate) : null,
    hasPlannedMonthly,
    plannedMonthly: hasPlannedMonthly ? plannedMonthly : null,
    accounts: accounts.map((share) => ({ ...share })),
  };
};

/** Values are i18n keys. A stored past date stays valid so an overdue goal can still be saved. */
export const validateGoalForm = ({
  state,
  storedTargetDate = null,
  today = toDateKey(new Date()),
}: {
  state: GoalFormState;
  storedTargetDate?: string | null;
  today?: string;
}): GoalFormErrors => {
  const targetDate = state.targetDate ? toDateKey(state.targetDate) : null;

  return {
    name: state.name.trim() ? null : 'goals.form.errors.nameRequired',
    targetAmount: isPositive(state.targetAmount) ? null : 'goals.form.errors.amountRequired',
    targetDate:
      targetDate && targetDate <= today && targetDate !== storedTargetDate ? 'goals.form.errors.dateNotFuture' : null,
    plannedMonthly:
      state.hasPlannedMonthly && !isPositive(state.plannedMonthly) ? 'goals.form.errors.amountRequired' : null,
    accounts: state.accounts.length ? null : 'goals.form.errors.accountsRequired',
  };
};

/** Expects a state that passed `validateGoalForm`. */
export const buildGoalPayload = ({ state }: { state: GoalFormState }): CreateGoalPayload => {
  if (!isPositive(state.targetAmount)) throw new Error('buildGoalPayload: targetAmount must be positive');

  return {
    name: state.name.trim(),
    currencyCode: state.currencyCode,
    targetAmount: state.targetAmount,
    targetDate: state.targetDate ? toDateKey(state.targetDate) : null,
    plannedMonthly: state.hasPlannedMonthly ? state.plannedMonthly : null,
    accounts: state.accounts,
  };
};

/** Base-currency decimals; shares of accounts missing from `accountsById` count 0. */
export const sumCountedAmount = ({
  shares,
  accountsById,
}: {
  shares: GoalAccountShare[];
  accountsById: Record<string, Pick<AccountModel, 'refCurrentBalance' | 'refCreditLimit'> | undefined>;
}) =>
  shares.reduce((sum, { accountId, sharePercent }) => {
    const account = accountsById[accountId];
    if (!account) return sum;
    const { refCurrentBalance: balance, refCreditLimit: creditLimit } = account;
    return sum + accountGoalValue({ balance, creditLimit, sharePercent });
  }, 0);

/** Owned accounts of an eligible category; an archived one only while the goal already links it. */
export const isGoalEligibleAccount = ({
  account,
  linkedAccountIds,
}: {
  account: Pick<AccountModel, 'id' | 'accountCategory' | 'status' | 'share'>;
  linkedAccountIds: RecordId[];
}) =>
  GOAL_ELIGIBLE_ACCOUNT_CATEGORIES.includes(account.accountCategory) &&
  (!account.share || account.share.isOwner === true) &&
  (account.status === ACCOUNT_STATUSES.active || linkedAccountIds.includes(account.id));

export const getShareError = ({
  sharePercent,
  max,
}: {
  sharePercent: number | null;
  max: number;
}): 'invalid' | 'overMax' | null => {
  if (sharePercent === null || !(roundShare(sharePercent) > 0)) return 'invalid';
  return roundShare(sharePercent) > max ? 'overMax' : null;
};

export type GoalFormServerError =
  | { field: 'accounts'; details: GoalShareCapacityExceededDetails | null }
  | { field: 'currencyCode'; currencyCode: string; message: string | null };

export const getGoalFormServerError = ({
  error,
  currencyCode,
}: {
  error: unknown;
  currencyCode: string;
}): GoalFormServerError | null => {
  if (isApiErrorWithCode(error, API_ERROR_CODES.goalShareCapacityExceeded)) {
    const details = error.data.details as GoalShareCapacityExceededDetails | undefined;
    return { field: 'accounts', details: details ?? null };
  }
  if (isApiErrorWithCode(error, API_ERROR_CODES.goalCurrencyRateUnavailable)) {
    return { field: 'currencyCode', currencyCode, message: error.data.message || null };
  }
  return null;
};

/** Null until there is a target. Amounts are in the goal currency; `counted` is null when no rate is known. */
export const getGoalFormSummary = ({
  state,
  counted,
  today = toDateKey(new Date()),
}: {
  state: GoalFormState;
  counted: number | null;
  today?: string;
}): { isCovered: boolean; neededMonthly: number | null } | null => {
  if (!isPositive(state.targetAmount)) return null;
  if (counted === null) return { isCovered: false, neededMonthly: null };

  const remaining = state.targetAmount - counted;
  if (remaining <= 0) return { isCovered: true, neededMonthly: null };

  const targetDate = state.targetDate ? toDateKey(state.targetDate) : null;
  return { isCovered: false, neededMonthly: neededMonthly({ remaining, today, targetDate }).neededMonthly };
};
