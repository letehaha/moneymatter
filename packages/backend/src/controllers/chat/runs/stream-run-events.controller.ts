import { recordId } from '@common/lib/zod/custom-types';
import type { CustomResponse } from '@common/types';
import { errorHandler } from '@controllers/helpers';
import { logger } from '@js/utils/logger';
import { validateRequest } from '@middlewares/validations';
import type Users from '@models/users.model';
import { normalizeLastEventId } from '@services/chat/runs/event-log';
import { findRunMessage } from '@services/chat/runs/find-run-message';
import { pipeRunEvents } from '@services/chat/runs/stream-run-events';
import type { Request } from 'express';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ runId: recordId() }),
});

/**
 * `GET /chat/runs/:runId/events`: the run's events as SSE. `Last-Event-ID` (what `fetch-event-source`
 * sends when it reconnects) resumes after that stream id. A refused request answers as JSON, before
 * any SSE header is written.
 */
// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- errors are handled in the try/catch below
export default async function streamRunEvents(req: Request, res: CustomResponse): Promise<void> {
  try {
    const validated = validateRequest({ schema, req, res });
    if (!validated) return;

    const runId = validated.params.runId;
    const message = await findRunMessage({ userId: (req.user as Users).id, runId });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');

    await pipeRunEvents({
      res,
      runId,
      messageId: message.id,
      afterId: normalizeLastEventId({ value: req.get('Last-Event-ID') }),
    });
  } catch (error) {
    if (res.headersSent) {
      logger.error({ message: 'A chat run stream failed', error: error as Error });
      if (!res.writableEnded) res.end();
      return;
    }
    errorHandler(res, error as Error);
  }
}
