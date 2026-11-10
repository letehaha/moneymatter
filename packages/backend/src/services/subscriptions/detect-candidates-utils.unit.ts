import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';

import {
  type TransactionForGrouping,
  detectFixedDayCadence,
  isFuzzyNameMatch,
  mapIntervalToFrequency,
  normalizeNote,
  splitByAmountBuckets,
} from './detect-candidates-utils';

describe('normalizeNote', () => {
  it('lowercases and trims', () => {
    expect(normalizeNote({ note: '  NETFLIX  ' })).toBe('netflix');
  });

  it('strips reference numbers (6+ digits)', () => {
    expect(normalizeNote({ note: 'Payment 123456789' })).toBe('payment');
  });

  it('preserves short digit sequences (< 6 digits)', () => {
    expect(normalizeNote({ note: 'HBO Max 2024' })).toBe('hbo max 2024');
  });

  it('strips date patterns dd/mm/yyyy', () => {
    expect(normalizeNote({ note: 'Netflix 15/01/2025' })).toBe('netflix');
  });

  it('strips date patterns yyyy-mm-dd', () => {
    expect(normalizeNote({ note: 'Spotify 2025-01-15' })).toBe('spotify');
  });

  it('strips date patterns dd.mm.yyyy', () => {
    expect(normalizeNote({ note: 'Payment 01.12.2024' })).toBe('payment');
  });

  it('strips special characters', () => {
    expect(normalizeNote({ note: 'NETFLIX.COM/PAYMENT#123' })).toBe('netflixcompayment123');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeNote({ note: 'spotify   premium   plan' })).toBe('spotify premium plan');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeNote({ note: '' })).toBe('');
  });

  it('handles note with only special chars', () => {
    expect(normalizeNote({ note: '***---###' })).toBe('');
  });

  it('handles combined stripping (ref number + date + special chars)', () => {
    expect(normalizeNote({ note: 'PAYMENT 12345678 ON 15/01/2025 @STORE' })).toBe('payment on store');
  });
});

describe('isFuzzyNameMatch', () => {
  it('matches identical names', () => {
    expect(isFuzzyNameMatch({ a: 'Netflix', b: 'Netflix' })).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isFuzzyNameMatch({ a: 'NETFLIX', b: 'netflix' })).toBe(true);
  });

  it('matches when one contains the other', () => {
    expect(isFuzzyNameMatch({ a: 'Netflix', b: 'Netflix subscription' })).toBe(true);
  });

  it('matches when contained in reverse', () => {
    expect(isFuzzyNameMatch({ a: 'Netflix subscription', b: 'Netflix' })).toBe(true);
  });

  it('matches with different spacing/formatting', () => {
    expect(isFuzzyNameMatch({ a: 'Digital Ocean', b: 'DigitalOcean' })).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(isFuzzyNameMatch({ a: 'Netflix', b: 'Spotify' })).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(isFuzzyNameMatch({ a: '', b: 'Netflix' })).toBe(false);
    expect(isFuzzyNameMatch({ a: 'Netflix', b: '' })).toBe(false);
  });

  it('strips reference numbers before comparing', () => {
    expect(isFuzzyNameMatch({ a: 'Netflix 12345678', b: 'Netflix' })).toBe(true);
  });
});

describe('mapIntervalToFrequency', () => {
  it('maps <= 10 days to weekly', () => {
    expect(mapIntervalToFrequency({ medianDays: 7 })).toBe(SUBSCRIPTION_FREQUENCIES.weekly);
    expect(mapIntervalToFrequency({ medianDays: 10 })).toBe(SUBSCRIPTION_FREQUENCIES.weekly);
  });

  it('maps 11-21 days to biweekly', () => {
    expect(mapIntervalToFrequency({ medianDays: 11 })).toBe(SUBSCRIPTION_FREQUENCIES.biweekly);
    expect(mapIntervalToFrequency({ medianDays: 14 })).toBe(SUBSCRIPTION_FREQUENCIES.biweekly);
    expect(mapIntervalToFrequency({ medianDays: 21 })).toBe(SUBSCRIPTION_FREQUENCIES.biweekly);
  });

  it('maps 22-50 days to monthly', () => {
    expect(mapIntervalToFrequency({ medianDays: 22 })).toBe(SUBSCRIPTION_FREQUENCIES.monthly);
    expect(mapIntervalToFrequency({ medianDays: 30 })).toBe(SUBSCRIPTION_FREQUENCIES.monthly);
    expect(mapIntervalToFrequency({ medianDays: 50 })).toBe(SUBSCRIPTION_FREQUENCIES.monthly);
  });

  it('maps 51-120 days to quarterly', () => {
    expect(mapIntervalToFrequency({ medianDays: 51 })).toBe(SUBSCRIPTION_FREQUENCIES.quarterly);
    expect(mapIntervalToFrequency({ medianDays: 90 })).toBe(SUBSCRIPTION_FREQUENCIES.quarterly);
    expect(mapIntervalToFrequency({ medianDays: 120 })).toBe(SUBSCRIPTION_FREQUENCIES.quarterly);
  });

  it('maps 121-270 days to semiAnnual', () => {
    expect(mapIntervalToFrequency({ medianDays: 121 })).toBe(SUBSCRIPTION_FREQUENCIES.semiAnnual);
    expect(mapIntervalToFrequency({ medianDays: 180 })).toBe(SUBSCRIPTION_FREQUENCIES.semiAnnual);
    expect(mapIntervalToFrequency({ medianDays: 270 })).toBe(SUBSCRIPTION_FREQUENCIES.semiAnnual);
  });

  it('maps > 270 days to annual', () => {
    expect(mapIntervalToFrequency({ medianDays: 271 })).toBe(SUBSCRIPTION_FREQUENCIES.annual);
    expect(mapIntervalToFrequency({ medianDays: 365 })).toBe(SUBSCRIPTION_FREQUENCIES.annual);
  });
});

function makeTx({ amount }: { amount: number }): TransactionForGrouping {
  return {
    id: `00000000-0000-0000-0000-${Math.random().toString(16).slice(2, 14)}`,
    amount,
    note: 'test',
    time: new Date(),
    accountId: generateRandomRecordId(),
    currencyCode: 'USD',
  };
}

describe('splitByAmountBuckets', () => {
  it('groups identical amounts into one bucket', () => {
    const txs = [makeTx({ amount: -1000 }), makeTx({ amount: -1000 }), makeTx({ amount: -1000 })];
    const buckets = splitByAmountBuckets({ transactions: txs });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toHaveLength(3);
  });

  it('separates amounts that differ by more than 10%', () => {
    const txs = [
      makeTx({ amount: -1000 }),
      makeTx({ amount: -1000 }),
      makeTx({ amount: -5000 }),
      makeTx({ amount: -5000 }),
    ];
    const buckets = splitByAmountBuckets({ transactions: txs });

    expect(buckets).toHaveLength(2);
  });

  it('groups amounts within 10% tolerance', () => {
    // 1000 and 1050 differ by 5% — should be same bucket
    const txs = [makeTx({ amount: -1000 }), makeTx({ amount: -1050 }), makeTx({ amount: -1020 })];
    const buckets = splitByAmountBuckets({ transactions: txs });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(splitByAmountBuckets({ transactions: [] })).toHaveLength(0);
  });

  it('handles single transaction', () => {
    const buckets = splitByAmountBuckets({ transactions: [makeTx({ amount: -500 })] });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toHaveLength(1);
  });

  it('respects custom tolerance', () => {
    // 1000 and 1150 differ by 15% — within 20% tolerance but outside default 10%
    const txs = [makeTx({ amount: -1000 }), makeTx({ amount: -1150 })];

    const defaultBuckets = splitByAmountBuckets({ transactions: txs });
    expect(defaultBuckets).toHaveLength(2);

    const looseBuckets = splitByAmountBuckets({ transactions: txs, tolerance: 0.2 });
    expect(looseBuckets).toHaveLength(1);
  });
});

describe('detectFixedDayCadence', () => {
  const DAY_MS = 86_400_000;
  /** Payments every `days` days from Jan 5, 2026, at varying times of day. */
  const everyNDays = ({ days, count }: { days: number; count: number }) =>
    Array.from(
      { length: count },
      (_, i) => new Date(Date.UTC(2026, 0, 5) + i * days * DAY_MS + (i % 2 ? 9 : 17) * 3_600_000),
    );
  const onDayOfMonth = ({ day, count }: { day: number; count: number }) =>
    Array.from({ length: count }, (_, i) => {
      const lastDay = new Date(Date.UTC(2026, i + 1, 0)).getUTCDate();
      return new Date(Date.UTC(2026, i, Math.min(day, lastDay), 12));
    });

  it('finds every 30 days from four payments', () => {
    expect(detectFixedDayCadence({ dates: everyNDays({ days: 30, count: 4 }) })).toEqual({
      unit: SUBSCRIPTION_INTERVAL_UNITS.day,
      count: 30,
    });
  });

  it('finds every 28 days, in any input order', () => {
    expect(detectFixedDayCadence({ dates: everyNDays({ days: 28, count: 5 }).toReversed() })).toEqual({
      unit: SUBSCRIPTION_INTERVAL_UNITS.day,
      count: 28,
    });
  });

  it.each([10, 31])('leaves a calendar-monthly bill on day %i to the presets', (day) => {
    expect(detectFixedDayCadence({ dates: onDayOfMonth({ day, count: 12 }) })).toBeNull();
  });

  it('leaves every 14 days to the biweekly preset', () => {
    expect(detectFixedDayCadence({ dates: everyNDays({ days: 14, count: 6 }) })).toBeNull();
  });

  it('ignores cadences shorter than a week', () => {
    expect(detectFixedDayCadence({ dates: everyNDays({ days: 3, count: 6 }) })).toBeNull();
  });

  it('gives up on a missed payment', () => {
    const dates = everyNDays({ days: 30, count: 5 }).filter((_, i) => i !== 2);
    expect(detectFixedDayCadence({ dates })).toBeNull();
  });

  it('gives up when one interval is a day off', () => {
    const dates = everyNDays({ days: 30, count: 4 });
    dates[3] = new Date(dates[3]!.getTime() + DAY_MS);
    expect(detectFixedDayCadence({ dates })).toBeNull();
  });

  it('needs at least three intervals', () => {
    expect(detectFixedDayCadence({ dates: everyNDays({ days: 30, count: 3 }) })).toBeNull();
  });
});
