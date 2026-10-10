import { makeRequest } from './common';

/** `payload` is loosely typed so tests can send bodies the schema must reject. */
export function recordClientLog<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'post',
    url: '/client-logs',
    payload,
    raw,
  });
}
