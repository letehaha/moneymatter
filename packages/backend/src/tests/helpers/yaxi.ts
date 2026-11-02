import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { accountSyncQueue } from '@services/bank-data-providers/sync/account-sync-queue';
import { MOCK_YAXI_KEY, mockYaxiBank } from '@tests/mocks/routex-refresh-client';
import { createHmac } from 'node:crypto';

import bankDataProviders from './bank-data-providers';
import { MakeRequestReturn, makeRequest } from './common';

const connect = <R extends boolean | undefined = false>({
  credentials = MOCK_YAXI_KEY,
  raw,
}: {
  credentials?: Record<string, unknown>;
  raw?: R;
} = {}) => bankDataProviders.connectProvider<R>({ providerType: BANK_PROVIDER_TYPE.YAXI, credentials, raw });

const issueTicket = <R extends boolean | undefined = false>({
  connectionId,
  payload,
  raw,
}: {
  connectionId: string;
  payload?: Record<string, unknown>;
  raw?: R;
}): Promise<MakeRequestReturn<{ ticket: string; apiUrl: string }, R>> =>
  makeRequest<{ ticket: string; apiUrl: string }, R>({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/yaxi/ticket`,
    payload,
    raw,
  });

const decodeTicketId = ({ ticket }: { ticket: string }): string =>
  JSON.parse(Buffer.from(ticket.split('.')[1]!, 'base64url').toString()).data.id;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** What YAXI hands the browser when a login finishes: a result JWT signed with the user's secret. */
const buildResultJwt = ({ ticketId, secret = MOCK_YAXI_KEY.secret }: { ticketId: string; secret?: string }) => {
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT', kid: MOCK_YAXI_KEY.keyId })}.${encode({
    data: { ticketId, data: [], timestamp: new Date().toISOString() },
    exp: Math.floor(Date.now() / 1000) + 600,
  })}`;
  const signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
};

const complete = ({
  connectionId,
  resultJwt,
  connectionData = mockYaxiBank.connectionData.toString('base64'),
}: {
  connectionId: string;
  resultJwt: string;
  connectionData?: string;
}) =>
  makeRequest({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/yaxi/complete`,
    payload: {
      resultJwt,
      connectionData,
      bankConnectionId: 'connection-mock',
      bankName: 'Mock Bank',
      logoId: 'logo-mock',
    },
  });

const login = async ({ connectionId }: { connectionId: string }) => {
  const { ticket } = await issueTicket({ connectionId, raw: true });
  return complete({ connectionId, resultJwt: buildResultJwt({ ticketId: decodeTicketId({ ticket }) }) });
};

/** Creates a connection and finishes the browser login, without importing any account. */
const connectAndLogin = async () => {
  const { connectionId } = await connect({ raw: true });
  await login({ connectionId });

  return { connectionId };
};

// A settled status can precede BullMQ removing the finished job, and a lingering job would swallow the next trigger.
const waitForJobRemoval = async ({ connectionId, timeoutMs = 30000 }: { connectionId: string; timeoutMs?: number }) => {
  const startTime = Date.now();
  while (await accountSyncQueue.getJob(`account-sync-${connectionId}`)) {
    if (Date.now() - startTime >= timeoutMs) {
      throw new Error(`Sync job for connection ${connectionId} was not removed within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export default {
  connect,
  issueTicket,
  decodeTicketId,
  buildResultJwt,
  complete,
  login,
  connectAndLogin,
  waitForJobRemoval,
};
