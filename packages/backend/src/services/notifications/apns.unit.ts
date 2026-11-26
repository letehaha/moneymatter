import { NOTIFICATION_TYPES, type NotificationModel } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { generateKeyPairSync, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';

type Reply = { status: number; body?: string } | Error;
const replies = new Map<string, Reply>();
const requests: Record<string, unknown>[] = [];

const fakeStream = (headers: Record<string, unknown>) => {
  const stream = Object.assign(new EventEmitter(), {
    setEncoding: () => {},
    setTimeout: () => {},
    close: () => {},
    end: (body: string) => {
      requests.push({ ...headers, body: JSON.parse(body) });
      const reply = replies.get(String(headers[':path']).split('/').pop()!) ?? { status: 200 };
      setImmediate(() => {
        if (reply instanceof Error) return stream.emit('error', reply);
        stream.emit('response', { ':status': reply.status });
        if (reply.body) stream.emit('data', reply.body);
        stream.emit('end');
        stream.emit('close');
      });
    },
  });
  return stream;
};

jest.mock('node:http2', () => ({
  __esModule: true,
  default: {
    constants: { NGHTTP2_CANCEL: 8 },
    connect: jest.fn(() =>
      Object.assign(new EventEmitter(), {
        setTimeout: () => {},
        close: () => {},
        destroy: () => {},
        request: fakeStream,
      }),
    ),
  },
}));

jest.mock('@models/device-tokens.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), destroy: jest.fn() },
}));

jest.mock('@js/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

/* eslint-disable import/first */
import DeviceTokens from '@models/device-tokens.model';
import http2 from 'node:http2';

import { sendNotificationPush } from './apns';

const findAll = DeviceTokens.findAll as unknown as jest.Mock<() => Promise<unknown[]>>;
const destroy = DeviceTokens.destroy as unknown as jest.Mock;

const device = (id: string, environment = 'production') => ({
  id,
  token: id,
  environment,
  bundleId: 'app.moneymatter.mobile',
});

const notification = {
  id: 'n1',
  userId: 1,
  type: NOTIFICATION_TYPES.watchlistAlert,
  title: 'AAPL closed above 200',
  message: 'Closed at 201',
  payload: {
    portfolioId: 'p1',
    portfolioName: 'Main',
    securityId: 's1',
    symbol: 'AAPL',
    assetClass: 'stocks',
    logoUrl: 'https://cdn.example/aapl.png',
    securityName: 'Apple Inc.',
    currencyCode: 'USD',
    close: '201.0000000000',
    previousClose: null,
    changePercent: null,
    closeDate: '2026-11-25',
  },
} as unknown as NotificationModel;

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

describe('sendNotificationPush', () => {
  beforeEach(() => {
    process.env.APPLE_KEY_ID = 'KEY123';
    process.env.APPLE_TEAM_ID = 'TEAM123';
    process.env.APPLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    replies.clear();
    requests.length = 0;
    jest.clearAllMocks();
  });

  it('sends the alert to every device on its environment host', async () => {
    findAll.mockResolvedValue([device('aa'), device('bb', 'sandbox')]);

    await sendNotificationPush({ notification });

    expect((http2.connect as jest.Mock).mock.calls.map(([host]) => host).toSorted()).toEqual([
      'https://api.push.apple.com',
      'https://api.sandbox.push.apple.com',
    ]);
    expect(requests[0]).toMatchObject({
      ':method': 'POST',
      'apns-topic': 'app.moneymatter.mobile',
      'apns-push-type': 'alert',
      authorization: expect.stringMatching(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/),
      body: {
        aps: {
          alert: { title: 'AAPL closed above 200', body: 'Closed at 201' },
          sound: 'default',
          'thread-id': 'p1',
          'mutable-content': 1,
          category: 'WATCHLIST_ALERT',
        },
        notificationId: 'n1',
        type: 'watchlist_alert',
        portfolioId: 'p1',
        securityId: 's1',
        symbol: 'AAPL',
        assetClass: 'stocks',
        logoUrl: 'https://cdn.example/aapl.png',
        securityName: 'Apple Inc.',
        portfolioName: 'Main',
        close: '201.0000000000',
        currencyCode: 'USD',
        closeDate: '2026-11-25',
      },
    });
    const [header, claims, signature] = String(requests[0]!.authorization).replace('bearer ', '').split('.');
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({ iss: 'TEAM123' });
    expect(requests[0]!.body).not.toHaveProperty('previousClose');
    expect(requests[0]!.body).not.toHaveProperty('changePercent');
    expect(destroy).not.toHaveBeenCalled();
  });

  it('deletes tokens APNs reports as dead and keeps the rest', async () => {
    findAll.mockResolvedValue([
      device('gone'),
      device('bad'),
      device('unreg'),
      device('ok'),
      device('busy'),
      device('err'),
    ]);
    replies.set('gone', { status: 410, body: '{"reason":"ExpiredToken"}' });
    replies.set('bad', { status: 400, body: '{"reason":"BadDeviceToken"}' });
    replies.set('unreg', { status: 410, body: '{"reason":"Unregistered"}' });
    replies.set('busy', { status: 429, body: '{"reason":"TooManyRequests"}' });
    replies.set('err', new Error('stream reset'));

    await sendNotificationPush({ notification });

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith({ where: { id: ['gone', 'bad', 'unreg'] } });
  });

  it('omits a non-https logo url', async () => {
    findAll.mockResolvedValue([device('aa')]);

    await sendNotificationPush({
      notification: {
        ...notification,
        payload: { portfolioId: 'p1', symbol: 'AAPL', logoUrl: 'http://cdn.example/a.png' },
      },
    });

    expect(requests[0]!.body).not.toHaveProperty('logoUrl');
  });

  it('sends only the alert for other notification types', async () => {
    findAll.mockResolvedValue([device('aa')]);

    await sendNotificationPush({
      notification: { ...notification, type: NOTIFICATION_TYPES.system, message: null },
    });

    expect(requests[0]!.body).toEqual({
      aps: { alert: { title: 'AAPL closed above 200' }, sound: 'default', 'thread-id': 'system' },
      notificationId: 'n1',
      type: 'system',
    });
  });

  it('never throws when the lookup fails', async () => {
    findAll.mockRejectedValue(new Error('db down'));
    await expect(sendNotificationPush({ notification })).resolves.toBeUndefined();
  });
});
