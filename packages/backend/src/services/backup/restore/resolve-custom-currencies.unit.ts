import type { BackupManifest } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '@js/errors';

import type { BackupFileName } from '../registry';
import type { ParsedArchive } from './load-archive';
import { readCustomCurrencyDefinitions } from './resolve-custom-currencies';

type Row = Record<string, unknown>;

const ISO_CODES = new Set(['USD', 'EUR']);

const holding = (row: Row = {}): Row => ({
  id: 'held-usdt',
  currencyCode: 'USDT',
  nameOverride: 'Tether',
  decimalsOverride: 6,
  symbolOverride: null,
  isDefaultCurrency: false,
  liveRateUpdate: false,
  ...row,
});

const rate = (row: Row = {}): Row => ({
  baseCode: 'USDT',
  quoteCode: 'USD',
  rate: '1.000000000000000000',
  effectiveDate: '2026-01-01',
  ...row,
});

const archiveOf = ({ holdings, rates }: { holdings: Row[]; rates: Row[] }): ParsedArchive => ({
  manifest: {} as BackupManifest,
  data: new Map<BackupFileName, Row[]>([
    ['users-currencies', [{ id: 'held-usd', currencyCode: 'USD' }, ...holdings]],
    ['user-exchange-rates', rates],
  ]),
  user: null,
  reference: { securities: [] },
  unknownFileNames: [],
});

const read = ({ holdings, rates }: { holdings: Row[]; rates: Row[] }) =>
  readCustomCurrencyDefinitions({ archive: archiveOf({ holdings, rates }), isoCodes: ISO_CODES });

describe('readCustomCurrencyDefinitions', () => {
  it('puts a custom currency from an archive without rate sources on its own rates', () => {
    const definitions = read({ holdings: [holding()], rates: [rate()] });

    expect(definitions.get('USDT')?.rateSourceSetting).toEqual({ rateSource: 'manual', rateSourceConfig: null });
  });

  it('accepts a peg to an ISO currency without stored rates', () => {
    const config = { pegCurrency: 'USD', factor: 1 };
    const definitions = read({ holdings: [holding({ rateSource: 'peg', rateSourceConfig: config })], rates: [] });

    expect(definitions.get('USDT')?.rateSourceSetting).toEqual({ rateSource: 'peg', rateSourceConfig: config });
  });

  it.each([
    ['an unreadable peg', { rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD' } }],
    ['a peg to a custom code', { rateSource: 'peg', rateSourceConfig: { pegCurrency: 'SAT', factor: 1 } }],
    ['the market feed', { rateSource: 'provider', rateSourceConfig: null }],
    ['an unknown source', { rateSource: 'oracle', rateSourceConfig: null }],
  ])('refuses %s', (_label, source) => {
    expect(() => read({ holdings: [holding(source)], rates: [rate()] })).toThrow(ValidationError);
  });

  it('refuses a synced source that stored no rate', () => {
    const source = { rateSource: 'coingecko', rateSourceConfig: { coinId: 'tether', quoteCurrency: 'USD' } };

    expect(() => read({ holdings: [holding(source)], rates: [] })).toThrow(ValidationError);
  });

  it('clears the header names of an HTTP source', () => {
    const config = {
      urlTemplate: 'https://rates.example.com/{code}',
      jsonPath: 'price',
      quoteCurrency: 'USD',
      headerNames: ['X-Api-Key'],
    };
    const definitions = read({
      holdings: [holding({ rateSource: 'http', rateSourceConfig: config })],
      rates: [rate()],
    });

    expect(definitions.get('USDT')?.rateSourceSetting).toEqual({
      rateSource: 'http',
      rateSourceConfig: { ...config, headerNames: [] },
    });
  });

  it('keeps rates in several ISO quotes and holds each quote', () => {
    const archive = archiveOf({ holdings: [holding()], rates: [rate(), rate({ quoteCode: 'EUR' })] });

    readCustomCurrencyDefinitions({ archive, isoCodes: ISO_CODES });

    const held = archive.data.get('users-currencies')!.map((row) => row.currencyCode);
    expect(held.toSorted()).toEqual(['EUR', 'USD', 'USDT']);
  });

  it('refuses a custom currency without a positive rate of its own', () => {
    expect(() => read({ holdings: [holding()], rates: [rate({ rate: '0' })] })).toThrow(ValidationError);
  });
});
