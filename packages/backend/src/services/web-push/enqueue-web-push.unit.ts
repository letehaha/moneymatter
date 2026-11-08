import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockAdd = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAddBulk = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetConfig = jest.fn<() => unknown>();
const mockNamespaceGet = jest.fn<(key: string) => unknown>();
const mockWarn = jest.fn();

jest.mock('./push-queue', () => ({
  webPushQueue: { add: mockAdd, addBulk: mockAddBulk },
  webPushQueueName: 'web-push-test',
}));
jest.mock('./config', () => ({ getWebPushConfig: mockGetConfig }));
jest.mock('@models/connection', () => ({ namespace: { get: mockNamespaceGet } }));
jest.mock('@js/utils/logger', () => ({ logger: { warn: mockWarn, info: jest.fn(), error: jest.fn() } }));

import { enqueueWebPushAfterCommit } from './enqueue-web-push';

const NOTIFICATION_ID = '7c0e1c1e-3d5a-4b7e-9a51-0f6a3c2b9d10';
const SECOND_ID = '8d1f2d2f-4e6b-4c8f-8b62-1a7b4d3c0e21';

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('enqueueWebPushAfterCommit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAdd.mockReset().mockResolvedValue(undefined);
    mockAddBulk.mockReset().mockResolvedValue(undefined);
    mockWarn.mockReset();
    mockGetConfig.mockReset().mockReturnValue({ keyId: 'k' });
    mockNamespaceGet.mockReset().mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues nothing without a VAPID config', async () => {
    mockGetConfig.mockReturnValue(null);

    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
    await flush();

    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockAddBulk).not.toHaveBeenCalled();
  });

  it('enqueues nothing for an empty id list', async () => {
    enqueueWebPushAfterCommit({ notificationIds: [] });
    await flush();

    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockAddBulk).not.toHaveBeenCalled();
  });

  it('adds a fan-out job at once when no transaction is active', async () => {
    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
    await flush();

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      'fan-out',
      expect.objectContaining({ notificationId: NOTIFICATION_ID }),
      expect.objectContaining({ jobId: `push-fanout-${NOTIFICATION_ID}` }),
    );
  });

  it('treats a finished transaction like none', async () => {
    mockNamespaceGet.mockReturnValue({ finished: 'commit', afterCommit: jest.fn() });

    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
    await flush();

    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('adds one bulk call for several ids', async () => {
    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID, SECOND_ID] });
    await flush();

    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockAddBulk).toHaveBeenCalledTimes(1);
    const [jobs] = mockAddBulk.mock.calls[0] as [Array<{ name: string; opts: { jobId: string } }>];
    expect(jobs.map((job) => job.opts.jobId)).toEqual([`push-fanout-${NOTIFICATION_ID}`, `push-fanout-${SECOND_ID}`]);
  });

  describe('inside a transaction', () => {
    const activeTransaction = () => {
      const callbacks: Array<() => unknown> = [];
      const transaction = { afterCommit: (callback: () => unknown) => callbacks.push(callback) };
      mockNamespaceGet.mockReturnValue(transaction);
      return callbacks;
    };

    it('waits for the commit', async () => {
      const callbacks = activeTransaction();

      enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
      await flush();
      expect(mockAdd).not.toHaveBeenCalled();
      expect(callbacks).toHaveLength(1);

      callbacks[0]!();
      await flush();
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });

    it('returns from the afterCommit callback at once while the queue never answers', async () => {
      mockAdd.mockReturnValue(new Promise(() => {}));
      const callbacks = activeTransaction();

      enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
      const result = callbacks[0]!();

      // A returned promise would make Sequelize's commit wait for it.
      expect(result).toBeUndefined();
    });
  });

  it('logs one warning without the payload when the queue never answers', async () => {
    mockAdd.mockReturnValue(new Promise(() => {}));

    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
    await flush();
    expect(mockWarn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    await flush();

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(String(mockWarn.mock.calls[0]![0])).toContain('[Web Push] enqueue failed or timed out');
    expect(String(mockWarn.mock.calls[0]![0])).not.toContain(NOTIFICATION_ID);
  });

  it('logs and swallows a rejected add', async () => {
    mockAdd.mockRejectedValue(new Error('Connection is closed.'));

    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
    await flush();

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(String(mockWarn.mock.calls[0]![0])).toContain('[Web Push] enqueue failed or timed out');
  });

  it('does not leak an unhandled rejection when a timed-out add rejects later', async () => {
    let rejectAdd!: (error: Error) => void;
    mockAdd.mockReturnValue(new Promise((_, reject) => (rejectAdd = reject)));
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    enqueueWebPushAfterCommit({ notificationIds: [NOTIFICATION_ID] });
    jest.advanceTimersByTime(2000);
    await flush();
    rejectAdd(new Error('late'));
    await flush();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
