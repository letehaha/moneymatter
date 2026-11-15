import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { listAppliedCards } from '@services/chat/proposals/list-applied';
import { z } from 'zod';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;

const schema = z.object({
  query: z.object({
    cursor: recordId().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  }),
});

export default createController(schema, async ({ user, query }) => ({
  data: await listAppliedCards({ userId: user.id, cursor: query.cursor, limit: query.limit }),
}));
