import { PLANS } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { redisClient } from '@root/redis-client';

import { getAiAllowance, recordAiSpend } from './ai-allowance';

jest.mock('../entitlements/resolve-entitlements.service', () => ({ getEntitlementsByUserId: jest.fn() }));
jest.mock('@js/utils/logger', () => ({ logger: { error: jest.fn() } }));

const CAP_ENV_VARS = ['AI_MONTHLY_CAP_USD_PLUS', 'AI_MONTHLY_CAP_USD_TRIAL'] as const;
const TRIAL = { plan: null, subscriptions: [] };
const PLUS = { plan: PLANS.plus, subscriptions: [] };

const redisGetMock = jest.mocked(redisClient.get) as unknown as jest.Mock<(key: string) => Promise<string | null>>;

const allowance = ({
  spentUsd,
  entitlements = TRIAL,
}: {
  spentUsd: number;
  entitlements?: typeof TRIAL | typeof PLUS;
}) => {
  redisGetMock.mockResolvedValue(String(spentUsd * 1_000_000));
  return getAiAllowance({ userId: 1, entitlements });
};

describe('getAiAllowance', () => {
  const envBeforeTest = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of CAP_ENV_VARS) {
      envBeforeTest.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of CAP_ENV_VARS) {
      const value = envBeforeTest.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('returns null when no cap is set for the user', async () => {
    process.env.AI_MONTHLY_CAP_USD_PLUS = '10';

    expect(await allowance({ spentUsd: 5 })).toBeNull();
  });

  it.each([
    [0, 0, 'ok'],
    [5.9, 59, 'ok'],
    [6, 60, 'warning'],
    [10, 100, 'reached'],
    [25, 100, 'reached'],
  ])('spending $%d of $10 reads %d%% and %s', async (spentUsd, usedPercent, state) => {
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '10';

    expect(await allowance({ spentUsd })).toMatchObject({ usedPercent, state, plan: 'trial' });
  });

  it('reads the Plus cap for a paid Plus user', async () => {
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '1';
    process.env.AI_MONTHLY_CAP_USD_PLUS = '10';

    expect(await allowance({ spentUsd: 2, entitlements: PLUS })).toMatchObject({ usedPercent: 20, plan: 'plus' });
    expect(await allowance({ spentUsd: 2 })).toMatchObject({ state: 'reached', plan: 'trial' });
  });

  it('treats a zero cap as reached', async () => {
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '0';

    expect(await allowance({ spentUsd: 0 })).toMatchObject({ usedPercent: 100, state: 'reached' });
  });

  it('reads the current UTC month and resets at the start of the next one, across a year boundary', async () => {
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '10';
    jest.useFakeTimers({ now: new Date('2026-12-31T23:59:00Z') });

    try {
      const result = await allowance({ spentUsd: 1 });

      expect(redisGetMock).toHaveBeenLastCalledWith('ai-spend:1:2026-12');
      expect(result?.resetsAt).toBe('2027-01-01T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails open when Redis cannot be read', async () => {
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '10';
    redisGetMock.mockRejectedValueOnce(new Error('redis down'));

    expect(await getAiAllowance({ userId: 1, entitlements: TRIAL })).toMatchObject({ state: 'ok', usedPercent: 0 });
  });
});

describe('recordAiSpend', () => {
  it('resolves when Redis rejects the write', async () => {
    jest.mocked(redisClient.incrby).mockRejectedValueOnce(new Error('redis down'));

    await expect(recordAiSpend({ userId: 1, costUsd: 0.5 })).resolves.toBeUndefined();
  });
});
