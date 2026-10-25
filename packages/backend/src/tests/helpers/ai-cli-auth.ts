import type { AICliProvider, CliAiAvailability, CliAuthSessionInfo, CliAuthSessionStatus } from '@bt/shared/types';

import { makeRequest, sleep } from './common';

const CLI_URL = '/user/settings/ai/cli';

export async function getCliAvailability<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<CliAiAvailability, R>({ method: 'get', url: `${CLI_URL}/availability`, raw });
}

export async function startCliAuthSession<R extends boolean | undefined = undefined>({
  provider,
  raw,
}: {
  provider: AICliProvider | string;
  raw?: R;
}) {
  return makeRequest<CliAuthSessionInfo, R>({
    method: 'post',
    url: `${CLI_URL}/auth-sessions`,
    payload: { provider },
    raw,
  });
}

export async function getCliAuthSession<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<CliAuthSessionInfo, R>({ method: 'get', url: `${CLI_URL}/auth-sessions/${id}`, raw });
}

export async function submitCliAuthCode<R extends boolean | undefined = undefined>({
  id,
  code,
  raw,
}: {
  id: string;
  code: string;
  raw?: R;
}) {
  return makeRequest<CliAuthSessionInfo, R>({
    method: 'post',
    url: `${CLI_URL}/auth-sessions/${id}/code`,
    payload: { code },
    raw,
  });
}

export async function cancelCliAuthSession<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<void, R>({ method: 'delete', url: `${CLI_URL}/auth-sessions/${id}`, raw });
}

const FINAL_STATUSES: CliAuthSessionStatus[] = ['succeeded', 'failed', 'expired'];

/** Polls the session until it reaches `status`; fails when it settles in a different final state. */
export async function waitForCliAuthSession({
  id,
  status,
  timeoutMs = 15_000,
}: {
  id: string;
  status: CliAuthSessionStatus;
  timeoutMs?: number;
}): Promise<CliAuthSessionInfo> {
  const deadline = Date.now() + timeoutMs;
  let session = await getCliAuthSession({ id, raw: true });

  while (session.status !== status) {
    if (FINAL_STATUSES.includes(session.status)) {
      throw new Error(`CLI auth session settled as ${session.status} (${session.error ?? 'no error'}), not ${status}`);
    }

    if (Date.now() > deadline) throw new Error(`CLI auth session still ${session.status} after ${timeoutMs} ms`);

    await sleep(100);
    session = await getCliAuthSession({ id, raw: true });
  }

  return session;
}
