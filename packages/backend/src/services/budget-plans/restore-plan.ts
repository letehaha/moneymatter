import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { getBaseCurrency } from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { UniqueConstraintError } from 'sequelize';

import { attachEligibleAccounts } from './auto-attach-account';
import { getPlan } from './get-plan';
import { lockPlan } from './lock-plan';

const restorePlanImpl = async ({ userId, planId }: { userId: number; planId: RecordId }) => {
  const plan = await lockPlan({ planId, userId, includeDeleted: true });
  if (!plan.deletedAt) return getPlan({ userId, planId });

  const baseCurrency = await getBaseCurrency({ userId });
  if (!baseCurrency) {
    throw new ValidationError({ message: t({ key: 'currencies.noBaseCurrency' }) });
  }
  if (baseCurrency.currencyCode !== plan.currencyCode) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.baseCurrencyChanged' }) });
  }

  try {
    await plan.restore();
  } catch (error) {
    // The partial unique index is the one-active-plan guard.
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError({ message: t({ key: 'budgetPlans.activePlanExists' }) });
    }
    throw error;
  }

  await attachEligibleAccounts({ userId });

  return getPlan({ userId, planId });
};

export const restorePlan = withTransaction(restorePlanImpl);
