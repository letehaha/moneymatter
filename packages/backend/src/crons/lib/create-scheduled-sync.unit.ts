import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LockedError } from '@js/errors';
import { logger } from '@js/utils';
import { CronJob } from 'cron';

import { createScheduledSync } from './create-scheduled-sync';

jest.mock('@js/utils', () => ({ __esModule: true, logger: { info: jest.fn(), error: jest.fn() } }));
jest.mock('cron', () => ({ CronJob: { from: jest.fn(() => ({ stop: jest.fn() })) } }));

const info = logger.info as jest.Mock;
const error = logger.error as jest.Mock;
const cronFrom = CronJob.from as jest.Mock;

const build = (run: (params?: { limit?: number }) => Promise<object>) =>
  createScheduledSync({
    name: 'demo job',
    cronExpression: '* * * * *',
    timeZone: 'UTC',
    scheduleDescription: 'every minute',
    errorCode: 'DEMO_CRON',
    run,
  });

/** The scheduled path is only reachable through the tick handed to `CronJob.from`. */
const tick = async (): Promise<void> => {
  const params = cronFrom.mock.calls[0]![0] as { onTick: () => Promise<void> };
  await params.onTick();
};

describe('createScheduledSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs arrays as counts and the run duration', async () => {
    const cron = build(async () => ({ processed: 3, results: [{ userId: 1 }], errors: ['boom'] }));
    cron.startCron();
    await tick();

    expect(info).toHaveBeenCalledWith('Scheduled demo job completed', {
      processed: 3,
      resultsCount: 1,
      errorsCount: 1,
      durationMs: expect.any(Number),
    });
  });

  it('logs a scheduled failure with the error code and does not reject the tick', async () => {
    const failure = new Error('db down');
    build(async () => {
      throw failure;
    }).startCron();

    await expect(tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      { message: 'Scheduled demo job failed', error: failure },
      { code: 'DEMO_CRON_FAILED' },
    );
  });

  it('treats an overlapping run as a skip, not a failure', async () => {
    build(async () => {
      throw new LockedError({ message: 'locked' });
    }).startCron();
    await tick();

    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Scheduled demo job skipped — previous run still in progress');
  });

  it('passes params through on manual trigger and rethrows with the manual code', async () => {
    const run = jest.fn(async (params?: { limit?: number }) => ({ limit: params?.limit }));
    const cron = build(run);

    await expect(cron.triggerManualSync({ limit: 5 })).resolves.toEqual({ limit: 5 });
    expect(run).toHaveBeenCalledWith({ limit: 5 });

    const failure = new Error('nope');
    await expect(
      build(async () => {
        throw failure;
      }).triggerManualSync(),
    ).rejects.toBe(failure);
    expect(error).toHaveBeenCalledWith(
      { message: 'Manual demo job failed', error: failure },
      { code: 'DEMO_CRON_MANUAL_FAILED' },
    );
  });
});
