import { EXCHANGE_RATE_PROVIDER_TYPE } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import ExchangeRates from '@models/exchange-rates.model';
import { connection } from '@models/index';
import UsersCurrencies from '@models/users-currencies.model';
import { initializeHistoricalRates } from '@services/exchange-rates/initialize-historical-rates.service';
import * as helpers from '@tests/helpers';
import { getCurrencyRatesApiResponseMock } from '@tests/mocks/exchange-rates/data';
import {
  CURRENCY_RATES_API_ENDPOINT_REGEX,
  FAWAZ_CURRENCY_API_ENDPOINT_REGEX,
} from '@tests/mocks/exchange-rates/endpoints';
import { createOverride } from '@tests/mocks/helpers';
import { startOfDay } from 'date-fns';
import { HttpResponse, http } from 'msw';

// The mocked providers quote BTC (the ApiLayer and fawaz baskets, and below the primary's range answer), so a
// user-defined BTC is the code that would leak into the global rates if a reader forgot to exclude it.
const CUSTOM_CODE = 'BTC';

describe('custom currencies stay out of global readers', () => {
  beforeEach(async () => {
    const { id: userId } = await helpers.getUserInfo({ raw: true });
    await helpers.seedCustomCurrencyRow({ code: CUSTOM_CODE, name: 'Bitcoin', digits: 8, createdByUserId: userId });
    await UsersCurrencies.create({
      userId,
      currencyCode: CUSTOM_CODE,
      isDefaultCurrency: false,
      liveRateUpdate: false,
    });
  });

  afterEach(async () => {
    global.mswMockServer.resetHandlers();
    await helpers.removeCustomCurrencyRow({ code: CUSTOM_CODE });
  });

  it("does not show another user's logo for the same custom code", async () => {
    const logoUrl = 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png';
    const updated = await helpers.updateCustomCurrency({ code: CUSTOM_CODE, payload: { logoUrl } });
    expect(updated.statusCode).toBe(200);

    const otherUser = await helpers.signUpSecondUser();
    await helpers.asUser({
      cookies: otherUser.cookies,
      fn: async () => {
        const created = await helpers.createCustomCurrency({
          payload: { code: CUSTOM_CODE, name: 'My Bitcoin', decimals: 8 },
        });
        expect(created.statusCode).toBe(201);
        expect(created.body.response).toMatchObject({ logoUrl: null });

        const held = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === CUSTOM_CODE);
        expect(held!.logoUrl).toBeNull();
        expect((await helpers.listCustomCurrencies({ raw: true })).map((item) => item.logoUrl)).toEqual([null]);
      },
    });

    const owned = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === CUSTOM_CODE);
    expect(owned!.logoUrl).toBe(logoUrl);
  });

  it('GET /models/currencies lists no custom code for its owner or for any other user', async () => {
    const asOwner = await helpers.getAllCurrencies();
    expect(asOwner.length).toBeGreaterThan(100);
    expect(asOwner.map((currency) => currency.code)).not.toContain(CUSTOM_CODE);
    expect(asOwner.every((currency) => currency.isCustom === false)).toBe(true);

    const otherUser = await helpers.signUpSecondUser();
    const asOther = await helpers.asUser({ cookies: otherUser.cookies, fn: () => helpers.getAllCurrencies() });
    expect(asOther.map((currency) => currency.code)).not.toContain(CUSTOM_CODE);
    expect(asOther.map((currency) => currency.code)).toContain('USD');
  });

  it('the daily sync stores no market rate for a custom code that fawaz quotes', async () => {
    const today = startOfDay(new Date());
    await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date >= :today`, {
      replacements: { today },
    });

    // The default mocks make fawaz answer with its whole basket, BTC included.
    await expect(helpers.syncExchangeRates().then((r) => r.statusCode)).resolves.toBe(200);

    expect(await ExchangeRates.count({ where: { quoteCode: 'EUR', date: today } })).toBeGreaterThan(0);
    expect(await ExchangeRates.count({ where: { quoteCode: CUSTOM_CODE } })).toBe(0);
  });

  it('the daily sync stores no market rate for a custom code that ApiLayer quotes', async () => {
    const today = startOfDay(new Date());
    await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date >= :today`, {
      replacements: { today },
    });

    // With fawaz down the paid ApiLayer fills the gaps, and its basket includes BTC too.
    createOverride(global.mswMockServer, FAWAZ_CURRENCY_API_ENDPOINT_REGEX).setOverride({ status: 500 });
    await expect(helpers.syncExchangeRates().then((r) => r.statusCode)).resolves.toBe(200);

    const apiLayerRows = await ExchangeRates.count({
      where: { source: EXCHANGE_RATE_PROVIDER_TYPE.API_LAYER, date: today },
    });
    expect(apiLayerRows).toBeGreaterThan(0);
    expect(await ExchangeRates.count({ where: { quoteCode: CUSTOM_CODE } })).toBe(0);
  });

  it('the historical backfill ingests no rate for a custom code', async () => {
    const snapshot = (await ExchangeRates.findAll({ raw: true })) as unknown as Array<Record<string, unknown>>;

    global.mswMockServer.use(
      http.get(CURRENCY_RATES_API_ENDPOINT_REGEX, ({ request }) => {
        if (request.url.includes('/health')) {
          return HttpResponse.json({ status: 'ok', version: '0.1.0' });
        }
        const range = request.url.match(/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
        if (!range) {
          return new HttpResponse(JSON.stringify({ error: 'unexpected request' }), { status: 400 });
        }
        const [, startDate, endDate] = range as unknown as [string, string, string];
        const withCustom = (date: string) => ({
          ...getCurrencyRatesApiResponseMock(date).rates,
          [CUSTOM_CODE]: 0.00001,
        });
        return HttpResponse.json({
          amount: 1,
          base: 'USD',
          start_date: startDate,
          end_date: endDate,
          rates: { [startDate]: withCustom(startDate), [endDate]: withCustom(endDate) },
        });
      }),
    );

    try {
      await ExchangeRates.destroy({ where: {} });
      await initializeHistoricalRates();

      expect(await ExchangeRates.count({ where: { quoteCode: 'EUR' } })).toBeGreaterThan(0);
      expect(await ExchangeRates.count({ where: { quoteCode: CUSTOM_CODE } })).toBe(0);
    } finally {
      await ExchangeRates.destroy({ where: {} });
      await ExchangeRates.bulkCreate(snapshot as never[], { ignoreDuplicates: true });
    }
  });
});
