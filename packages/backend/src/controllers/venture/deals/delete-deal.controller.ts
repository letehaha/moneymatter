import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteVentureDeal } from '@services/venture/deals/delete.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    body: z
      .object({
        force: z.boolean().optional(),
        deleteLinkedTransactions: z.boolean().optional(),
      })
      .optional(),
  }),
  async ({ user, params, body }) => {
    const result = await deleteVentureDeal({
      userId: user.id,
      dealId: params.id,
      force: body?.force,
      deleteLinkedTransactions: body?.deleteLinkedTransactions,
    });
    return { data: result };
  },
);
