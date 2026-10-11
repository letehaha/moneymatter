import { RecordId } from '@bt/shared/types';
import { trackEvent } from '@js/utils/posthog';
import { withTransaction } from '@services/common/with-transaction';

import { findLine, findPlan } from './find-plan';

/** Permanent: the FKs cascade its membership and assignment rows, so its categories become unbudgeted everywhere. */
const deleteLineImpl = async ({
  userId,
  planId,
  lineId,
}: {
  userId: number;
  planId: RecordId;
  lineId: RecordId;
}): Promise<void> => {
  const plan = await findPlan({ planId, userId, lock: true });
  const line = await findLine({ planId: plan.id, lineId });
  await line.destroy();
  trackEvent({ userId, event: 'budget_line_deleted', properties: { origin: line.origin } });
};

export const deleteLine = withTransaction(deleteLineImpl);
