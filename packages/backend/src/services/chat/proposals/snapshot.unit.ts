import type { ChatProposalSnapshot } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as usersCurrencies from '@models/users-currencies.model';

import { buildSnapshot, compareSnapshots, hashTargetIds, latestUpdatedAt } from './snapshot';

const A = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const B = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const PARENT = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';

const snapshot = (overrides: Partial<ChatProposalSnapshot> = {}): ChatProposalSnapshot => ({
  baseCurrencyCode: 'USD',
  updatedAt: '2026-10-18T09:00:00.000Z',
  targetHash: hashTargetIds({ ids: [A, B] }),
  targetCount: 2,
  parentStatuses: { [PARENT]: 'pending' },
  ...overrides,
});

describe('hashTargetIds', () => {
  it('ignores order and repeats and tells different sets apart', () => {
    expect(hashTargetIds({ ids: [A, B] })).toBe(hashTargetIds({ ids: [B, A, A] }));
    expect(hashTargetIds({ ids: [A] })).not.toBe(hashTargetIds({ ids: [A, B] }));
    expect(hashTargetIds({ ids: [] })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('latestUpdatedAt', () => {
  it('returns the newest timestamp as ISO text and null when there is none', () => {
    expect(
      latestUpdatedAt({ dates: [new Date('2026-10-01T00:00:00Z'), '2026-10-05T00:00:00.000Z', null, undefined] }),
    ).toBe('2026-10-05T00:00:00.000Z');
    expect(latestUpdatedAt({ dates: [] })).toBeNull();
    expect(latestUpdatedAt({ dates: [null] })).toBeNull();
  });
});

describe('buildSnapshot', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds the base currency and the parents statuses to what the resolver captured', async () => {
    jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'EUR' } as never);

    const result = await buildSnapshot({
      userId: 7,
      resolved: { updatedAt: '2026-10-18T09:00:00.000Z', targetCount: 1 },
      parents: [{ id: PARENT, status: 'pending' }],
    });

    expect(result).toEqual({
      baseCurrencyCode: 'EUR',
      updatedAt: '2026-10-18T09:00:00.000Z',
      targetCount: 1,
      parentStatuses: { [PARENT]: 'pending' },
    });
  });

  it('uses an empty base currency code for a user with none', async () => {
    jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue(null as never);

    expect((await buildSnapshot({ userId: 7, parents: [] })).baseCurrencyCode).toBe('');
  });
});

describe('compareSnapshots', () => {
  it('is fresh when nothing moved', () => {
    expect(compareSnapshots({ stored: snapshot(), current: snapshot() })).toEqual({ stale: false });
  });

  it('is fresh when the snapshot holds no target set or timestamp to compare', () => {
    const bare = { baseCurrencyCode: 'USD' };

    expect(compareSnapshots({ stored: bare, current: bare })).toEqual({ stale: false });
  });

  it('is stale with both timestamps when a target was updated', () => {
    const current = snapshot({ updatedAt: '2026-10-18T10:30:00.000Z' });

    expect(compareSnapshots({ stored: snapshot(), current })).toEqual({
      stale: true,
      reasonKey: 'chat.stale.updated',
      before: '2026-10-18T09:00:00.000Z',
      after: '2026-10-18T10:30:00.000Z',
    });
  });

  it('is stale with both counts when the target set changed', () => {
    const current = snapshot({ targetHash: hashTargetIds({ ids: [A, B, PARENT] }), targetCount: 3 });

    expect(compareSnapshots({ stored: snapshot(), current })).toEqual({
      stale: true,
      reasonKey: 'chat.stale.targets',
      before: 2,
      after: 3,
    });
  });

  it('counts the frozen ids when the snapshot has no count', () => {
    const stored = snapshot({ targetCount: undefined, targetIds: [A, B] });
    const current = snapshot({ targetCount: undefined, targetIds: [A], targetHash: hashTargetIds({ ids: [A] }) });

    expect(compareSnapshots({ stored, current })).toMatchObject({ stale: true, before: 2, after: 1 });
  });

  it('is stale with both codes when the base currency changed', () => {
    expect(compareSnapshots({ stored: snapshot(), current: snapshot({ baseCurrencyCode: 'EUR' }) })).toEqual({
      stale: true,
      reasonKey: 'chat.stale.baseCurrency',
      before: 'USD',
      after: 'EUR',
    });
  });

  it.each(['rejected', 'failed', 'expired', 'stale', 'superseded'] as const)(
    'is stale when a parent became %s',
    (status) => {
      expect(
        compareSnapshots({ stored: snapshot(), current: snapshot({ parentStatuses: { [PARENT]: status } }) }),
      ).toEqual({ stale: true, reasonKey: 'chat.stale.parent', before: 'pending', after: status });
    },
  );

  it('does not call a parent that was applied meanwhile a change: its result id replaces the ref', () => {
    expect(
      compareSnapshots({ stored: snapshot(), current: snapshot({ parentStatuses: { [PARENT]: 'applied' } }) }),
    ).toEqual({ stale: false });
  });

  it('is stale when a parent is gone from the current snapshot', () => {
    expect(compareSnapshots({ stored: snapshot(), current: snapshot({ parentStatuses: {} }) })).toMatchObject({
      stale: true,
      reasonKey: 'chat.stale.parent',
      after: null,
    });
  });

  it('reports the base currency before the other reasons', () => {
    const current = snapshot({ baseCurrencyCode: 'EUR', updatedAt: '2027-01-01T00:00:00.000Z', targetCount: 9 });

    expect(compareSnapshots({ stored: snapshot(), current })).toMatchObject({ reasonKey: 'chat.stale.baseCurrency' });
  });
});
