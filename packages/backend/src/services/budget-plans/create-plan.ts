import { RecordId } from '@bt/shared/types';
import {
  BudgetPlanCadence,
  BudgetPlanCarryPolicy,
  BudgetSuggestionAnswers,
  CreateBudgetPlanResponse,
  BudgetPlanTypeKey,
} from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { invalidateAppUserCache } from '@middlewares/better-auth';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import { UniqueConstraintError } from 'sequelize';

import { getPlan } from './get-plan';
import {
  MAX_BACKDATED_PERIODS,
  PeriodCadenceConfig,
  boundaryAtOrBefore,
  countPeriodsBetween,
} from './periods/period-enumerator';
import { assertAccountsAttachable } from './set-plan-accounts';
import { addSuggestedLines } from './suggested-lines';
import { validateCadence } from './validate-cadence';

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

/** Starts the early adopter budget trial. Later plans and restores keep the first anchor. */
export const recordFirstBudgetPlan = async ({ userId }: { userId: number }): Promise<void> => {
  const [count, rows] = await Users.update(
    { firstBudgetPlanAt: new Date() },
    { where: { id: userId, firstBudgetPlanAt: null }, returning: true },
  );
  if (count && rows[0]?.authUserId) await invalidateAppUserCache({ authUserId: rows[0].authUserId });
};

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
  poolEnabled?: boolean;
  withSuggestedLines?: boolean;
  suggestionAnswers?: BudgetSuggestionAnswers;
}

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
  poolEnabled = false,
}: Omit<CreatePlanParams, 'withSuggestedLines' | 'suggestionAnswers'>): Promise<BudgetPlans> => {
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
      poolFrom: poolEnabled ? epoch : null,
    }),
  });
  await recordFirstBudgetPlan({ userId });

  await BudgetPlanAccounts.bulkCreate(accountIds.map((accountId) => ({ planId: plan.id, accountId })));

  return plan;
};

const createPlanRow = withTransaction(createPlanImpl);

/** Suggestions run after the plan commits: they may wait on a model, and a failure leaves a usable empty plan. */
export const createPlan = async ({
  withSuggestedLines = false,
  suggestionAnswers,
  ...params
}: CreatePlanParams): Promise<CreateBudgetPlanResponse> => {
  const { id: planId, userId } = await createPlanRow(params);

  const outcome = withSuggestedLines
    ? await addSuggestedLines({ userId, planId, answers: suggestionAnswers }).then(
        ({ answersIgnored }) => (answersIgnored ? { suggestionAnswersIgnored: true } : {}),
        (error: unknown) => {
          logger.error('[Budget plans] Suggested lines failed for a new plan', {
            userId,
            planId,
            error: error as Error,
          });
          return { suggestedLinesFailed: true };
        },
      )
    : {};

  return { ...(await getPlan({ userId, planId })), ...outcome };
};
