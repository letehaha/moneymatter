import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTrackerLine } from '@root/serializers';
import { updateTrackerLine } from '@services/budgets/lines/update-line';
import { z } from 'zod';

import { lineBodyFields } from './create-line';

const schema = z.object({
  params: z.object({ id: recordId(), lineId: recordId() }),
  body: z.object({
    name: lineBodyFields.name.optional(),
    limitAmount: lineBodyFields.limitAmount,
    categoryIds: lineBodyFields.categoryIds.optional(),
    position: lineBodyFields.position,
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const line = await updateTrackerLine({ userId: user.id, budgetId: params.id, lineId: params.lineId, ...body });

  return { data: serializeTrackerLine(line) };
});
