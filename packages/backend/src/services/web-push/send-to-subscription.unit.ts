import type { RecordId } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDestroy = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSendNotification = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetConfig = jest.fn<() => unknown>();
const mockNormalize = jest.fn<(...args: unknown[]) => string | null>();
const mockWarn = jest.fn();
const mockError = jest.fn();
const mockInfo = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('@models/push-subscriptions.model', () => ({
  __esModule: true,
  default: { update: mockUpdate, destroy: mockDestroy },
}));
jest.mock('web-push', () => ({ sendNotification: mockSendNotification }));
jest.mock('./config', () => ({ getWebPushConfig: mockGetConfig }));
jest.mock('./endpoint-allowlist', () => ({ normalizePushEndpoint: mockNormalize }));
jest.mock('@js/utils/logger', () => ({ logger: { warn: mockWarn, error: mockError, info: mockInfo } }));
jest.mock('@js/utils/sentry', () => ({ captureException: mockCaptureException }));

import { MAX_CONSECUTIVE_REJECTIONS, sendToSubscription } from './send-to-subscription';

const KEY_ID = 'key-1';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

const subscription = ({ endpoint = ENDPOINT, vapidKeyId = KEY_ID } = {}) => ({
  id: 'sub-1' as RecordId,
  endpoint,
  p256dh: 'p256dh',
  auth: 'auth',
  vapidKeyId,
});

const send = ({
  endpoint,
  recordTransientFailure = false,
}: { endpoint?: string; recordTransientFailure?: boolean } = {}) =>
  sendToSubscription({
    subscription: subscription({ endpoint }),
    payload: {} as never,
    ttl: 60,
    urgency: 'normal',
    topic: 'topic',
    recordTransientFailure,
  });

const pushError = ({ statusCode }: { statusCode: number }) =>
  Object.assign(new Error(`Received unexpected response code ${statusCode}`), { statusCode });

const whereOf = (call: unknown[]): Record<string, unknown> =>
  ((call.at(-1) ?? {}) as { where: Record<string, unknown> }).where;

describe('sendToSubscription', () => {
  beforeEach(() => {
    for (const mock of [mockUpdate, mockDestroy, mockSendNotification, mockWarn, mockError, mockInfo]) mock.mockReset();
    mockCaptureException.mockReset();
    mockGetConfig
      .mockReset()
      .mockReturnValue({ keyId: KEY_ID, subject: 'mailto:a@b.c', publicKey: 'pub', privateKey: 'priv' });
    mockNormalize.mockReset().mockImplementation((params) => (params as { endpoint: string }).endpoint);
    mockUpdate.mockResolvedValue([1, []]);
    mockDestroy.mockResolvedValue(1);
  });

  describe('a stale answer for a rotated endpoint', () => {
    it('deletes an expired endpoint by id and the endpoint the send used', async () => {
      mockSendNotification.mockRejectedValue(pushError({ statusCode: 410 }));

      expect(await send()).toBe('gone');

      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(whereOf(mockDestroy.mock.calls[0]!)).toEqual({ id: 'sub-1', endpoint: ENDPOINT });
    });

    it('guards the failure count update and the prune delete the same way', async () => {
      mockSendNotification.mockRejectedValue(pushError({ statusCode: 400 }));
      mockUpdate.mockResolvedValue([1, [{ failureCount: MAX_CONSECUTIVE_REJECTIONS }]]);

      expect(await send()).toBe('rejected');

      expect(whereOf(mockUpdate.mock.calls[0]!)).toEqual({ id: 'sub-1', endpoint: ENDPOINT });
      expect(whereOf(mockDestroy.mock.calls[0]!)).toEqual({ id: 'sub-1', endpoint: ENDPOINT });
    });

    it('guards the success stamp and the instance failure record by endpoint too', async () => {
      mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
      await send();
      expect(whereOf(mockUpdate.mock.calls[0]!)).toEqual({ id: 'sub-1', endpoint: ENDPOINT });

      mockUpdate.mockClear();
      mockSendNotification.mockRejectedValueOnce(pushError({ statusCode: 403 }));
      await send();
      expect(whereOf(mockUpdate.mock.calls[0]!)).toEqual({ id: 'sub-1', endpoint: ENDPOINT });
    });
  });

  describe('an endpoint the allowlist refuses', () => {
    beforeEach(() => {
      mockNormalize.mockReturnValue(null);
    });

    it('is an instance-side condition: no request, no counted rejection, no prune', async () => {
      expect(await send()).toBe('instance');

      expect(mockSendNotification).not.toHaveBeenCalled();
      expect(mockDestroy).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const [values] = mockUpdate.mock.calls[0]! as [Record<string, unknown>];
      expect(values).not.toHaveProperty('failureCount');
      expect(values).toMatchObject({ lastFailureStatus: null });
    });

    it('never prunes however often it repeats', async () => {
      for (let index = 0; index < MAX_CONSECUTIVE_REJECTIONS + 2; index += 1) await send();

      expect(mockDestroy).not.toHaveBeenCalled();
      for (const call of mockUpdate.mock.calls) {
        expect(call[0]).not.toHaveProperty('failureCount');
      }
    });

    it('logs once per host', async () => {
      // Hosts no other case uses: the once-per-process memory outlives a single test.
      await send({ endpoint: 'https://one.push.example.test/a' });
      await send({ endpoint: 'https://one.push.example.test/b' });
      await send({ endpoint: 'https://two.push.example.test/a' });

      expect(mockWarn).toHaveBeenCalledTimes(2);
    });
  });

  describe('the URL the request goes to', () => {
    it('is the validated, normalized one, never the stored raw string', async () => {
      mockNormalize.mockReturnValue('https://web.push.apple.com/normalized');
      mockSendNotification.mockResolvedValue({ statusCode: 201 });

      await send({ endpoint: 'https://WEB.PUSH.APPLE.COM:443/raw' });

      const [target] = mockSendNotification.mock.calls[0]! as [{ endpoint: string }];
      expect(target.endpoint).toBe('https://web.push.apple.com/normalized');
    });
  });

  describe('a bookkeeping write after a successful send', () => {
    it('does not fail the delivery when the write throws, so the job is not retried', async () => {
      mockSendNotification.mockResolvedValue({ statusCode: 201 });
      mockUpdate.mockRejectedValue(new Error('connection terminated'));

      await expect(send()).resolves.toBe('ok');

      expect(mockSendNotification).toHaveBeenCalledTimes(1);
      expect(mockError).toHaveBeenCalledTimes(1);
    });
  });
});
