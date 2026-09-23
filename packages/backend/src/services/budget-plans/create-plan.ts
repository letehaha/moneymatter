import { RecordId } from '@bt/shared/types';
import {
  BudgetPlanCadence,
  BudgetPlanCarryPolicy,
  BudgetPlanDetails,
  BudgetPlanTypeKey,
} from '@bt/shared/types/budget-plans';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { UniqueConstraintError } from 'sequelize';

import { getPlan } from './get-plan';
import {
  MAX_BACKDATED_PERIODS,
  PeriodCadenceConfig,
  anchorParts,
  boundaryAtOrBefore,
  countPeriodsBetween,
  validateSemiMonthlyDays,
} from './periods/period-enumerator';
import { assertAccountsAttachable } from './set-plan-accounts';

export const requireBaseCurrencyCode = async ({ userId }: { userId: number }): Promise<string> => {
  const baseCurrency = await getBaseCurrency({ userId });
  if (!baseCurrency) throw new ValidationError({ message: t({ key: 'currencies.noBaseCurrency' }) });
  return baseCurrency.currencyCode;
};

/** The partial unique index is the one-active-plan guard. */
export const asOnlyActivePlan = <T>({ write }: { write: Promise<T> }): Promise<T> =>
  write.catch((error) => {
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError({ message: t({ key: 'budgetPlans.activePlanExists' }) });
    }
    throw error;
  });

const MAX_INTERVAL_N: Record<BudgetPlanCadence, number> = { days: 366, months: 12, semi_monthly: 1 };

interface CreatePlanParams {
  userId: number;
  name: string;
  type: BudgetPlanTypeKey;
  cadence: BudgetPlanCadence;
  intervalN?: number;
  anchorDate: string;
  secondAnchorDay?: number | null;
  epochDate?: string;
  accountIds: RecordId[];
  autoAttachAccounts?: boolean;
  carryPolicy?: BudgetPlanCarryPolicy;
}

/** "Last day of the month" is `anchorDate.day = 31`; the enumerator clamps it. */
const validateCadence = ({ cadence, intervalN, anchorDate, secondAnchorDay }: PeriodCadenceConfig): void => {
  if (intervalN > MAX_INTERVAL_N[cadence]) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.intervalOutOfRange' }) });
  }

  if (cadence !== 'semi_monthly') {
    if (secondAnchorDay !== null) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.secondAnchorDayNotAllowed' }) });
    }
    return;
  }

  if (secondAnchorDay === null) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.secondAnchorDayRequired' }) });
  }
  const anchorDay = anchorParts({ plan: { anchorDate } }).day;
  if (!validateSemiMonthlyDays({ anchorDay, secondAnchorDay })) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.semiMonthlyDaysTooClose' }) });
  }
};

const createPlanImpl = async ({
  userId,
  name,
  type,
  cadence,
  intervalN = 1,
  anchorDate,
  secondAnchorDay = null,
  epochDate,
  accountIds,
  autoAttachAccounts = false,
  carryPolicy = 'none',
}: CreatePlanParams): Promise<BudgetPlanDetails> => {
  const cadenceConfig: PeriodCadenceConfig = { cadence, intervalN, anchorDate, secondAnchorDay };
  validateCadence(cadenceConfig);

  const today = toUtcDateString(new Date());
  if (epochDate && epochDate > today) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.epochInFuture' }) });
  }

  const epoch = boundaryAtOrBefore({ plan: cadenceConfig, date: epochDate ?? today });
  if (countPeriodsBetween({ plan: cadenceConfig, from: epoch, to: today }) > MAX_BACKDATED_PERIODS) {
    throw new ValidationError({
      message: t({ key: 'budgetPlans.epochTooFarBack', variables: { max: MAX_BACKDATED_PERIODS } }),
    });
  }

  await assertAccountsAttachable({ userId, accountIds });

  const currencyCode = await requireBaseCurrencyCode({ userId });
  const plan = await asOnlyActivePlan({
    write: BudgetPlans.create({
      userId,
      name,
      type,
      currencyCode,
      cadence,
      intervalN,
      anchorDate,
      secondAnchorDay,
      epochDate: epoch,
      carryPolicy,
      autoAttachAccounts,
    }),
  });

  await BudgetPlanAccounts.bulkCreate(accountIds.map((accountId) => ({ planId: plan.id, accountId })));

  return getPlan({ userId, planId: plan.id });
};

export const createPlan = withTransaction(createPlanImpl);
