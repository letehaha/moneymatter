import { RecordId } from '@bt/shared/types';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPeriodView } from './get-period-view';
import { ensureCurrentPeriods } from './periods/ensure-periods';
import { writeAssignment } from './set-assignment';

interface SetAssignmentsParams {
  assignments: { lineId: RecordId; amount: number | null }[];
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  timezone: string;
}

const setAssignmentsImpl = async ({ userId, planId, periodId, assignments, timezone }: SetAssignmentsParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods } = await ensureCurrentPeriods({ plan });

  for (const { lineId, amount } of assignments) {
    await writeAssignment({ userId, plan, periods, periodId, lineId, scope: 'this_period', amount });
  }

  return getPeriodView({ userId, planId, periodId, timezone });
};

/** Saves every line or none, so one failing line rolls back the others. */
export const setAssignments = withTransaction(setAssignmentsImpl);
