import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { redisClient } from '@root/redis-client';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';

import { REDIS_KEYS } from '../sync/sync-status-tracker';

const PSU_USER_AGENT = 'Mozilla/5.0 (PSU headers e2e)';
// Express trusts loopback proxies, so supertest's X-Forwarded-For becomes req.ip.
const PSU_IP = '8.8.8.8';
const PSU_REQUEST_HEADERS = { 'User-Agent': PSU_USER_AGENT, 'X-Forwarded-For': PSU_IP };

const ACCOUNT_ENDPOINT_RE = /^\/accounts\/[^/]+\/(details|balances|transactions)$/;

interface RecordedAccountRequest {
  path: string;
  psuIpAddress: string | null;
  psuUserAgent: string | null;
}

let recordedRequests: RecordedAccountRequest[] = [];

const recordAccountRequest = ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  if (url.hostname !== 'api.enablebanking.com' || !ACCOUNT_ENDPOINT_RE.test(url.pathname)) return;

  recordedRequests.push({
    path: url.pathname,
    psuIpAddress: request.headers.get('psu-ip-address'),
    psuUserAgent: request.headers.get('psu-user-agent'),
  });
};

async function authorizeConnection(): Promise<string> {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });

  const state = await helpers.enablebanking.getConnectionState(connectionId);

  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: { connectionId, code: helpers.enablebanking.mockAuthCode, state },
    headers: PSU_REQUEST_HEADERS,
  });

  return connectionId;
}

async function connectAccountWithPsuHeaders({ connectionId }: { connectionId: string }) {
  await helpers.makeRequest({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/sync-selected-accounts`,
    payload: { accountExternalIds: [MOCK_IDENTIFICATION_HASH_1] },
    headers: PSU_REQUEST_HEADERS,
  });
  await helpers.bankDataProviders.waitForAccountsSyncToSettle();
}

const requestsOf = ({ kind }: { kind: 'details' | 'balances' | 'transactions' }) =>
  recordedRequests.filter((r) => r.path.endsWith(`/${kind}`));

function expectAllWithPsuHeaders() {
  expect(recordedRequests.length).toBeGreaterThan(0);
  for (const request of recordedRequests) {
    expect(request).toEqual({ path: request.path, psuIpAddress: PSU_IP, psuUserAgent: PSU_USER_AGENT });
  }
}

useSelfHost();

describe('Enable Banking PSU headers', () => {
  beforeEach(() => {
    helpers.enablebanking.resetSessionCounter();
    recordedRequests = [];
    global.mswMockServer.events.on('request:start', recordAccountRequest);
  });

  afterEach(() => {
    global.mswMockServer.events.removeListener('request:start', recordAccountRequest);
    helpers.enablebanking.resetTransactionConfig();
  });

  describe('user-initiated requests send PSU headers', () => {
    it('GET /connections/:connectionId/available-accounts forwards the user IP and user agent', async () => {
      const connectionId = await authorizeConnection();
      recordedRequests = [];

      const response = await helpers.makeRequest({
        method: 'get',
        url: `/bank-data-providers/connections/${connectionId}/available-accounts`,
        headers: PSU_REQUEST_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(requestsOf({ kind: 'details' }).length).toBeGreaterThan(0);
      expect(requestsOf({ kind: 'balances' }).length).toBeGreaterThan(0);
      expectAllWithPsuHeaders();
    });

    it('POST /connections/:connectionId/sync-selected-accounts forwards PSU headers through the initial sync', async () => {
      const connectionId = await authorizeConnection();
      await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      recordedRequests = [];

      await connectAccountWithPsuHeaders({ connectionId });

      expect(requestsOf({ kind: 'transactions' }).length).toBeGreaterThan(0);
      expectAllWithPsuHeaders();
    });

    it('POST /sync/trigger forwards PSU headers into the queued sync job', async () => {
      const connectionId = await authorizeConnection();
      await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      await connectAccountWithPsuHeaders({ connectionId });
      recordedRequests = [];

      const response = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
        headers: PSU_REQUEST_HEADERS,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body.response.queuedAccounts).toBe(1);

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      expect(requestsOf({ kind: 'transactions' }).length).toBeGreaterThan(0);
      expectAllWithPsuHeaders();
    });
  });

  it('omits PSU headers when the user IP is not public (self-host on LAN/Docker)', async () => {
    const connectionId = await authorizeConnection();
    recordedRequests = [];

    const response = await helpers.makeRequest({
      method: 'get',
      url: `/bank-data-providers/connections/${connectionId}/available-accounts`,
      headers: { 'User-Agent': PSU_USER_AGENT, 'X-Forwarded-For': '192.168.1.50' },
    });

    expect(response.statusCode).toBe(200);
    expect(recordedRequests.length).toBeGreaterThan(0);
    for (const request of recordedRequests) {
      expect(request).toEqual({ path: request.path, psuIpAddress: null, psuUserAgent: null });
    }
  });

  describe('background requests omit PSU headers', () => {
    it('GET /sync/check auto-sync does not send PSU headers', async () => {
      const connectionId = await authorizeConnection();
      await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      await connectAccountWithPsuHeaders({ connectionId });
      await redisClient.del(REDIS_KEYS.userLastAutoSync(global.userId));
      recordedRequests = [];

      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/check',
        headers: PSU_REQUEST_HEADERS,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body.response.syncTriggered).toBe(true);

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      expect(requestsOf({ kind: 'transactions' }).length).toBeGreaterThan(0);
      for (const request of recordedRequests) {
        expect(request).toEqual({ path: request.path, psuIpAddress: null, psuUserAgent: null });
      }
    });
  });
});
