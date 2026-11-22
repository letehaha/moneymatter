import type { UserCurrencyModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { describeRateSource, getUrlHost } from './source-summary';

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as Parameters<typeof describeRateSource>[0]['t'];

const describeSource = ({ rateSource, rateSourceConfig }: Pick<UserCurrencyModel, 'rateSource' | 'rateSourceConfig'>) =>
  describeRateSource({ currency: { currencyCode: 'USDT', rateSource, rateSourceConfig }, t });

describe('getUrlHost', () => {
  it('reads the host of a URL with placeholders in its path and query', () => {
    expect(getUrlHost({ urlTemplate: 'https://api.example.com:8443/rates/{date}?base={code}' })).toBe(
      'api.example.com:8443',
    );
  });

  it('keeps a placeholder in the host', () => {
    expect(getUrlHost({ urlTemplate: 'https://{code}.example.com/rate' })).toBe('{code}.example.com');
  });

  it('falls back to the template when it is not a URL', () => {
    expect(getUrlHost({ urlTemplate: 'rates.example.com/{date}' })).toBe('rates.example.com/{date}');
    expect(getUrlHost({ urlTemplate: '' })).toBe('');
  });
});

describe('describeRateSource', () => {
  it('has no detail line for a rate the user enters', () => {
    expect(describeSource({ rateSource: 'manual', rateSourceConfig: null })).toEqual({
      value: 'settings.currencies.dialog.source.manual',
      detail: null,
    });
  });

  it('names the followed currency and the fixed amount', () => {
    expect(describeSource({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'EUR', factor: 2.5 } })).toEqual({
      value: 'settings.currencies.dialog.source.peg {"code":"EUR"}',
      detail: 'settings.currencies.dialog.source.pegDetail {"code":"USDT","factor":2.5,"target":"EUR"}',
    });
  });

  it('names the coin and the host of the synced sources', () => {
    expect(
      describeSource({ rateSource: 'coingecko', rateSourceConfig: { coinId: 'tether', quoteCurrency: 'USD' } }),
    ).toEqual({
      value: 'settings.currencies.dialog.source.coingecko {"coin":"tether"}',
      detail: 'settings.currencies.dialog.source.syncedDetail',
    });
    expect(
      describeSource({
        rateSource: 'http',
        rateSourceConfig: {
          urlTemplate: 'https://rates.example.org/{date}',
          jsonPath: '$.r',
          quoteCurrency: 'USD',
          headerNames: [],
        },
      }).value,
    ).toBe('settings.currencies.dialog.source.http {"host":"rates.example.org"}');
  });
});
