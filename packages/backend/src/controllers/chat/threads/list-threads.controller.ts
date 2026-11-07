import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { listThreads } from '@services/chat/threads/list.service';
import { z } from 'zod';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;
const MAX_QUERY_CHARS = 200;

const schema = z.object({
  query: z.object({
    q: z.string().max(MAX_QUERY_CHARS).optional(),
    cursor: recordId().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  }),
});

export default createController(schema, async ({ user, query }) => ({
  data: await listThreads({ userId: user.id, q: query.q, cursor: query.cursor, limit: query.limit }),
}));
