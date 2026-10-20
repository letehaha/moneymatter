import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { cancelRun } from '@services/chat/runs/cancel';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ runId: recordId() }),
});

export default createController(schema, async ({ user, params }) => ({
  data: await cancelRun({ userId: user.id, runId: params.runId }),
}));
