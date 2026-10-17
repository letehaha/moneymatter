import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteTrackerLine } from '@services/budgets/lines/delete-line';
import { z } from 'zod';

export default createController(
  z.object({ params: z.object({ id: recordId(), lineId: recordId() }) }),
  async ({ user, params }) => {
    await deleteTrackerLine({ userId: user.id, budgetId: params.id, lineId: params.lineId });

    return {};
  },
);
