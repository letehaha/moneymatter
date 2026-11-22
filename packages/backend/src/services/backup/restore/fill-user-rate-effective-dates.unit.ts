import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';

import type { BackupFileName } from '../registry';
import { fillUserRateEffectiveDates, forceKnownUserRateSources } from './fill-user-rate-effective-dates';

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

describe('forceKnownUserRateSources', () => {
  it('keeps a known source and restores any other as manual', () => {
    const data = dataOf({
      rows: [
        { baseCode: 'BTC', quoteCode: 'USD', source: 'coingecko' },
        { baseCode: 'PTS', quoteCode: 'USD', source: 'initial' },
        { baseCode: 'ETH', quoteCode: 'USD', source: 'peg' },
        { baseCode: 'SAT', quoteCode: 'USD', source: { evil: true } },
        { baseCode: 'XAU', quoteCode: 'USD' },
      ],
    });

    forceKnownUserRateSources({ data });

    expect(data.get('user-exchange-rates')!.map((row) => row.source)).toEqual([
      'coingecko',
      'initial',
      'manual',
      'manual',
      'manual',
    ]);
  });

  const withCustomCurrencies = ({ rates }: { rates: Row[] }) =>
    new Map<BackupFileName, Row[]>([
      [
        'users-currencies',
        [
          { currencyCode: 'USD' },
          { currencyCode: 'EUR' },
          { currencyCode: 'USDT', nameOverride: 'Tether', decimalsOverride: 6 },
          { currencyCode: 'PTS', nameOverride: 'Points', decimalsOverride: 0 },
          { currencyCode: 'BTC', nameOverride: 'Bitcoin', decimalsOverride: 8 },
        ],
      ],
      ['user-exchange-rates', rates],
    ]);

  it('restores the sole sourceless rate of a custom currency as initial', () => {
    const data = withCustomCurrencies({
      rates: [
        { baseCode: 'USDT', quoteCode: 'USD', effectiveDate: '2026-01-01' },
        { baseCode: 'USD', quoteCode: 'USDT', effectiveDate: '2026-01-01' },
      ],
    });

    forceKnownUserRateSources({ data });

    expect(data.get('user-exchange-rates')!.map((row) => [row.baseCode, row.source])).toEqual([
      ['USDT', 'initial'],
      ['USD', 'manual'],
    ]);
  });

  it('keeps a sourceless rate manual for an ISO pair or a custom currency with several rates', () => {
    const data = withCustomCurrencies({
      rates: [
        { baseCode: 'EUR', quoteCode: 'USD', effectiveDate: '2026-01-01' },
        { baseCode: 'PTS', quoteCode: 'USD', effectiveDate: '2026-01-01' },
        { baseCode: 'PTS', quoteCode: 'EUR', effectiveDate: '2026-02-01' },
        { baseCode: 'BTC', quoteCode: 'USD', effectiveDate: '2026-01-01', source: 'coingecko' },
      ],
    });

    forceKnownUserRateSources({ data });

    expect(data.get('user-exchange-rates')!.map((row) => [row.baseCode, row.source])).toEqual([
      ['EUR', 'manual'],
      ['PTS', 'manual'],
      ['PTS', 'manual'],
      ['BTC', 'coingecko'],
    ]);
  });
});
