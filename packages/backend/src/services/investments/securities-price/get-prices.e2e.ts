import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { startOfDayUtc } from '@services/investments/securities-price/pricing-anchor';
import * as helpers from '@tests/helpers';
import { addDays, addHours, subDays } from 'date-fns';

const seedHourlyPrices = async () => {
  const security = await Securities.create({
    symbol: 'HOURLY',
    providerSymbol: 'HOURLY',
    currencyCode: 'USD',
    providerName: SECURITY_PROVIDER.coingecko,
    assetClass: ASSET_CLASS.crypto,
    name: 'Hourly Test Coin',
  });
  const today = startOfDayUtc(new Date());
  const at = ({ days, hours }: { days: number; hours: number }) => addHours(subDays(today, days), hours);
  await SecurityPricing.bulkCreate([
    { securityId: security.id, date: at({ days: 2, hours: 23 }), priceClose: '12' },
    { securityId: security.id, date: at({ days: 10, hours: 0 }), priceClose: '5' },
    { securityId: security.id, date: at({ days: 3, hours: 23 }), priceClose: '11' },
    { securityId: security.id, date: at({ days: 3, hours: 1 }), priceClose: '10' },
    { securityId: security.id, date: at({ days: 2, hours: 6 }), priceClose: '13' },
  ]);
  return { security, dayKey: ({ days }: { days: number }) => subDays(today, days).toISOString().slice(0, 10) };
};

describe('GET /investments/prices', () => {
  it('serves prices filtered by date range', async () => {
    const invertedRange = await helpers.getSecuritiesPricesByDate({
      params: { from: addDays(new Date(), 5), to: new Date() },
    });

    expect(invertedRange.statusCode).toEqual(ERROR_CODES.ValidationError);

    const security = await Securities.create({
      symbol: 'RANGEHIT',
      providerSymbol: 'RANGEHIT',
      currencyCode: 'USD',
      providerName: SECURITY_PROVIDER.fmp,
      assetClass: ASSET_CLASS.stocks,
      name: 'Range Hit Test Security',
    });

    const emptyRangePrices = await helpers.getSecuritiesPricesByDate({
      params: { securityId: security.id, from: subDays(new Date(), 10), to: new Date() },
      raw: true,
    });

    expect(emptyRangePrices).toEqual([]);

    await SecurityPricing.create({ securityId: security.id, date: subDays(new Date(), 2), priceClose: '100' });
    await SecurityPricing.create({ securityId: security.id, date: subDays(new Date(), 30), priceClose: '200' });

    const prices = await helpers.getSecuritiesPricesByDate({
      params: {
        securityId: security.id,
        from: subDays(new Date(), 5),
        to: new Date(),
      },
      raw: true,
    });

    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ securityId: security.id, priceClose: 100 });
  }, 30000);

  describe('daily closes', () => {
    it('returns the last price of each UTC day, oldest first', async () => {
      const { security, dayKey } = await seedHourlyPrices();

      const prices = await helpers.getSecuritiesPricesByDate({
        params: { securityId: security.id, daily: true },
        raw: true,
      });

      expect(
        prices.map((price) => ({ day: new Date(price.date).toISOString().slice(0, 10), close: price.priceClose })),
      ).toEqual([
        { day: dayKey({ days: 10 }), close: 5 },
        { day: dayKey({ days: 3 }), close: 11 },
        { day: dayKey({ days: 2 }), close: 12 },
      ]);
    });

    it('bounds the daily closes by from', async () => {
      const { security } = await seedHourlyPrices();

      const prices = await helpers.getSecuritiesPricesByDate({
        params: { securityId: security.id, daily: true, from: subDays(new Date(), 5) },
        raw: true,
      });

      expect(prices.map((price) => price.priceClose)).toEqual([11, 12]);
    });

    it('keeps every row without the flag', async () => {
      const { security } = await seedHourlyPrices();

      const prices = await helpers.getSecuritiesPricesByDate({ params: { securityId: security.id }, raw: true });

      expect(prices).toHaveLength(5);
    });

    it('returns an empty list for a security without prices', async () => {
      const security = await Securities.create({
        symbol: 'NOPRICE',
        providerSymbol: 'NOPRICE',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'No Price Security',
      });

      expect(
        await helpers.getSecuritiesPricesByDate({ params: { securityId: security.id, daily: true }, raw: true }),
      ).toEqual([]);
    });

    it('rejects a malformed flag', async () => {
      const response = await helpers.makeRequest({ method: 'get', url: '/investments/prices?daily=yes' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
