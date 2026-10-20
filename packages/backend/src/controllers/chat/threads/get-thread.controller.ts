import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getThread } from '@services/chat/threads/get.service';
import { z } from 'zod';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

const schema = z.object({
  params: z.object({ id: recordId() }),
  query: z.object({
    before: recordId().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  }),
});

export default createController(schema, async ({ user, params, query }) => ({
  data: await getThread({ userId: user.id, threadId: params.id, before: query.before, limit: query.limit }),
}));
