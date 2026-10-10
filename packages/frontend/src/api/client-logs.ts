import { api } from '@/api/_api';
import type { RecordClientLogRequest } from '@bt/shared/types';

/**
 * Sends a client-side event to the backend log stream. Fire-and-forget: a failed
 * log call must never surface to the user or break the flow that reported it.
 */
export const logClientEvent = (body: RecordClientLogRequest): void => {
  api.post('/client-logs', body, { silent: true }).catch(() => {});
};
