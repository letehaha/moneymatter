import type { RecordClientLogRequest } from '@bt/shared/types';
import { logger } from '@js/utils';

// Always `logger.info`: `warn` and `error` also raise a Sentry event, and a
// browser-reported rejection is not a backend fault. The client's own severity
// travels as `clientLevel`. `context` stays nested so its keys cannot overwrite
// `message` or `level` on the log record.
export const recordClientLog = ({
  userId,
  event,
  level,
  context,
}: RecordClientLogRequest & { userId: number }): void => {
  logger.info(`[Client] ${event}`, { source: 'fe', clientLevel: level, userId, context });
};
