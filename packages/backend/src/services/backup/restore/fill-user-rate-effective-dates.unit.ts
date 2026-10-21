import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';

import type { BackupFileName } from '../registry';
import { fillUserRateEffectiveDates } from './fill-user-rate-effective-dates';

type Row = Record<string, unknown>;

const dataOf = ({ rows }: { rows: Row[] }) => new Map<BackupFileName, Row[]>([['user-exchange-rates', rows]]);

describe('fillUserRateEffectiveDates', () => {
  it('gives a rate the UTC day it was saved on', () => {
    const data = dataOf({
      rows: [
        { userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.9, date: '2026-03-04T23:59:59.000Z' },
        { userId: 1, baseCode: 'EUR', quoteCode: 'USD', rate: 1.1, date: '2026-03-05T00:00:00.000Z' },
      ],
    });

    fillUserRateEffectiveDates({ data });

    expect(data.get('user-exchange-rates')!.map((row) => row.effectiveDate)).toEqual(['2026-03-04', '2026-03-05']);
  });

  it('leaves a rate that already has a day alone', () => {
    const rows = [
      {
        userId: 1,
        baseCode: 'USDT',
        quoteCode: 'USD',
        rate: 1,
        date: '2026-03-04T10:00:00.000Z',
        effectiveDate: '2026-01-01',
      },
    ];
    const data = dataOf({ rows });

    fillUserRateEffectiveDates({ data });

    expect(data.get('user-exchange-rates')).toBe(rows);
    expect(rows[0]!.effectiveDate).toBe('2026-01-01');
  });

  it('keeps the rate saved last when two rows of a pair land on one day', () => {
    const data = dataOf({
      rows: [
        { userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.9, date: '2026-03-04T08:00:00.000Z' },
        { userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.95, date: '2026-03-04T20:00:00.000Z' },
        { userId: 2, baseCode: 'USD', quoteCode: 'EUR', rate: 0.8, date: '2026-03-04T08:00:00.000Z' },
      ],
    });

    fillUserRateEffectiveDates({ data });

    expect(data.get('user-exchange-rates')!.map((row) => [row.userId, row.rate])).toEqual([
      [1, 0.95],
      [2, 0.8],
    ]);
  });

  it('refuses a rate with no usable saved date', () => {
    const data = dataOf({ rows: [{ userId: 1, baseCode: 'USD', quoteCode: 'EUR', rate: 0.9, date: 'yesterday' }] });

    expect(() => fillUserRateEffectiveDates({ data })).toThrow(ValidationError);
  });

  it('does nothing for an archive without rates', () => {
    const data = new Map<BackupFileName, Row[]>();

    fillUserRateEffectiveDates({ data });

    expect(data.size).toBe(0);
  });
});
