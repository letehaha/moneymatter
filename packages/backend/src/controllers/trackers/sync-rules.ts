import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { syncTrackerRulesOnVisit } from '@services/trackers/rules/sync-tracker-rules';
import { z } from 'zod';

export default createController(z.object({ params: z.object({ id: recordId() }) }), async ({ user, params }) => ({
  data: await syncTrackerRulesOnVisit({ userId: user.id, trackerId: params.id }),
}));
