import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ExchangeRates from '@models/exchange-rates.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { exchangeRateProviderRegistry } from '@services/exchange-rates/providers';
import * as helpers from '@tests/helpers';
import { startOfDay } from 'date-fns';
import { Op } from 'sequelize';

describe('POST /investments/securities/prices/bulk-upload', () => {
  let originalAdminUsers: string | undefined;

  beforeEach(async () => {
    // Save original ADMIN_USERS env var
    originalAdminUsers = process.env.ADMIN_USERS;
  });

  afterEach(() => {
    // Restore original ADMIN_USERS env var
    if (originalAdminUsers !== undefined) {
      process.env.ADMIN_USERS = originalAdminUsers;
    } else {
      delete process.env.ADMIN_USERS;
    }
  });

  describe('Authorization', () => {
    it('enforces the admin guard', async () => {
      const payload = {
        searchResult: helpers.buildSecuritySearchResult(),
        prices: [{ price: 100, date: '2024-01-01', currency: 'USD' }],
      };

      delete process.env.ADMIN_USERS;
      const unconfigured = await helpers.bulkUploadSecurityPrices({ payload });
      expect(unconfigured.statusCode).toBe(ERROR_CODES.Unauthorized);

      process.env.ADMIN_USERS = 'admin-user';
      const nonAdmin = await helpers.bulkUploadSecurityPrices({ payload });
      expect(nonAdmin.statusCode).toBe(ERROR_CODES.Unauthorized);

      if (originalAdminUsers === undefined) {
        delete process.env.ADMIN_USERS;
      } else {
        process.env.ADMIN_USERS = originalAdminUsers;
      }
      const admin = await helpers.bulkUploadSecurityPrices({ payload });
      // Fails deeper on validation (no exchange rates), but passes authorization
      expect(admin.statusCode).not.toBe(ERROR_CODES.Unauthorized);
    }, 30000);
  });

  describe('Validation', () => {
    it('rejects malformed payloads', async () => {
      const emptyPrices = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: helpers.buildSecuritySearchResult(),
          prices: [],
        },
      });
      expect(emptyPrices.statusCode).toBe(ERROR_CODES.ValidationError);

      const negativePrice = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: helpers.buildSecuritySearchResult(),
          prices: [{ price: -100, date: '2024-01-01', currency: 'USD' }],
        },
      });
      expect(negativePrice.statusCode).toBe(ERROR_CODES.ValidationError);

      const oversizedPrice = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: helpers.buildSecuritySearchResult(),
          prices: [{ price: 1e13, date: '2024-01-01', currency: 'USD' }],
        },
      });
      expect(oversizedPrice.statusCode).toBe(ERROR_CODES.ValidationError);

      const badDateFormat = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: helpers.buildSecuritySearchResult(),
          prices: [{ price: 100, date: '01/01/2024', currency: 'USD' }],
        },
      });
      expect(badDateFormat.statusCode).toBe(ERROR_CODES.ValidationError);

      const badCurrencyCode = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: helpers.buildSecuritySearchResult(),
          prices: [{ price: 100, date: '2024-01-01', currency: 'US' }],
        },
      });
      expect(badCurrencyCode.statusCode).toBe(ERROR_CODES.ValidationError);
    }, 30000);

    it('rejects payloads the rate and currency checks cannot satisfy', async () => {
      const newestRate = await ExchangeRates.findOne({
        order: [['date', 'DESC']],
        attributes: ['date'],
        raw: true,
      });

      if (!newestRate) {
        throw new Error('No exchange rates found in test database');
      }

      const futureDate = new Date(newestRate.date);
      futureDate.setFullYear(futureDate.getFullYear() + 10);
      const futureDateStr = futureDate.toISOString().split('T')[0]!;

      // SSP is a valid ISO code with no exchange rates seeded, so the request
      // passes schema validation and fails deeper on the missing rate lookup.
      // Its own symbol keeps the SSP security separate from the USD cases below.
      const missingRates = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: await helpers.searchSecurityViaFmp({
            symbol: 'TESTSSP',
            name: 'Test Security',
            currencyCode: 'SSP',
          }),
          prices: [{ price: 100, date: '2024-01-01', currency: 'SSP' }],
        },
      });
      expect(missingRates.statusCode).toBe(ERROR_CODES.ValidationError);

      const usdSearchResult = await helpers.searchSecurityViaFmp({ symbol: 'TEST', name: 'Test Security' });

      const currencyMismatch = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: usdSearchResult,
          prices: [{ price: 100, date: '2024-01-01', currency: 'EUR' }],
        },
      });
      expect(currencyMismatch.statusCode).toBe(ERROR_CODES.ValidationError);

      const outOfRange = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: usdSearchResult,
          prices: [{ price: 100, date: futureDateStr, currency: 'USD' }],
          autoFilter: false,
        },
      });
      expect(outOfRange.statusCode).toBe(ERROR_CODES.ValidationError);

      const everythingFiltered = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: usdSearchResult,
          prices: [{ price: 100, date: futureDateStr, currency: 'USD' }],
          autoFilter: true,
        },
      });
      expect(everythingFiltered.statusCode).toBe(ERROR_CODES.ValidationError);
    }, 30000);

    it('rejects a new security that no provider search returned', async () => {
      const exchangeRate = await ExchangeRates.findOne({
        where: { [Op.or]: [{ baseCode: 'USD' }, { quoteCode: 'USD' }] },
        order: [['date', 'DESC']],
        attributes: ['date'],
        raw: true,
      });
      if (!exchangeRate) {
        throw new Error('No exchange rates found for USD');
      }

      const response = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult: helpers.buildSecuritySearchResult({ symbol: 'NEVERSEARCHED', providerSymbol: 'NEVERSEARCHED' }),
          prices: [{ price: 100, date: exchangeRate.date.toISOString().split('T')[0]!, currency: 'USD' }],
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await Securities.findOne({ where: { providerSymbol: 'NEVERSEARCHED' } })).toBeNull();
      expect(await SecurityPricing.count()).toBe(0);
    });
  });

  describe('Successful Upload', () => {
    it('should successfully upload prices for new security', async () => {
      const searchResult = await helpers.searchSecurityViaFmp({
        symbol: 'TESTUPLOAD',
        name: 'Test Upload Security',
        currencyCode: 'USD',
      });

      // Get valid date for USD
      const exchangeRate = await ExchangeRates.findOne({
        where: {
          [Op.or]: [{ baseCode: 'USD' }, { quoteCode: 'USD' }],
        },
        order: [['date', 'DESC']],
        attributes: ['date'],
        raw: true,
      });

      if (!exchangeRate) {
        throw new Error('No exchange rates found for USD');
      }

      // Use the available date from the test DB
      const validDate = exchangeRate.date.toISOString().split('T')[0]!;

      // Only upload one price since test DB may only have one date with exchange rates
      const prices = [{ price: 100.5, date: validDate, currency: 'USD' }];

      const response = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult,
          prices,
        },
        raw: true,
      });

      expect(response.newOldestDate).toBeTruthy();
      expect(response.newNewestDate).toBeTruthy();
      expect(response.summary.inserted).toBe(1);
      expect(response.summary.duplicates).toBe(0);
      expect(response.summary.filtered).toBe(0);

      // Verify prices were actually inserted
      const securityPrices = await SecurityPricing.findAll({
        where: { source: 'manual-upload' },
        order: [['date', 'ASC']],
      });

      expect(securityPrices).toHaveLength(1);
      expect(Number(securityPrices[0]!.priceClose)).toBe(100.5);
    });

    it('should ignore duplicates when override is false', async () => {
      const searchResult = await helpers.searchSecurityViaFmp({
        symbol: 'TESTDUP',
        name: 'Test Duplicate Security',
        currencyCode: 'USD',
      });

      const exchangeRate = await ExchangeRates.findOne({
        where: {
          [Op.or]: [{ baseCode: 'USD' }, { quoteCode: 'USD' }],
        },
        order: [['date', 'DESC']],
        attributes: ['date'],
        raw: true,
      });

      if (!exchangeRate) {
        throw new Error('No exchange rates found for USD');
      }

      const testDateStr = exchangeRate.date.toISOString().split('T')[0]!;

      const prices = [{ price: 100, date: testDateStr, currency: 'USD' }];

      // First upload
      const firstResponse = await helpers.bulkUploadSecurityPrices({
        payload: { searchResult, prices },
        raw: true,
      });

      expect(firstResponse.summary.inserted).toBe(1);
      expect(firstResponse.summary.duplicates).toBe(0);

      // Second upload with same date (should be ignored)
      const secondResponse = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult,
          prices: [{ price: 200, date: testDateStr, currency: 'USD' }],
          override: false,
        },
        raw: true,
      });

      expect(secondResponse.summary.inserted).toBe(0);
      expect(secondResponse.summary.duplicates).toBe(1);

      // Verify original price is unchanged
      const securityPrices = await SecurityPricing.findAll({
        where: { source: 'manual-upload' },
      });

      expect(securityPrices).toHaveLength(1);
      expect(Number(securityPrices[0]!.priceClose)).toBe(100);
    });

    it('should override duplicates when override is true', async () => {
      const searchResult = await helpers.searchSecurityViaFmp({
        symbol: 'TESTOVERRIDE',
        name: 'Test Override Security',
        currencyCode: 'USD',
      });

      const exchangeRate = await ExchangeRates.findOne({
        where: {
          [Op.or]: [{ baseCode: 'USD' }, { quoteCode: 'USD' }],
        },
        order: [['date', 'DESC']],
        attributes: ['date'],
        raw: true,
      });

      if (!exchangeRate) {
        throw new Error('No exchange rates found for USD');
      }

      const testDateStr = exchangeRate.date.toISOString().split('T')[0]!;

      const prices = [{ price: 100, date: testDateStr, currency: 'USD' }];

      // First upload
      await helpers.bulkUploadSecurityPrices({
        payload: { searchResult, prices },
        raw: true,
      });

      // Second upload with override
      const secondResponse = await helpers.bulkUploadSecurityPrices({
        payload: {
          searchResult,
          prices: [{ price: 200, date: testDateStr, currency: 'USD' }],
          override: true,
        },
        raw: true,
      });

      expect(secondResponse.summary.inserted).toBe(0);
      expect(secondResponse.summary.duplicates).toBe(1);

      // Verify price was updated
      const securityPrices = await SecurityPricing.findAll({
        where: { source: 'manual-upload' },
      });

      expect(securityPrices).toHaveLength(1);
      expect(Number(securityPrices[0]!.priceClose)).toBe(200);
    });

    it.todo('should filter out-of-range dates when autoFilter is true');
    // const searchResult = helpers.buildSecuritySearchResult({
    //   symbol: 'TESTFILTER',
    //   name: 'Test Filter Security',
    //   currencyCode: 'USD',
    // });

    // const oldestRate = await ExchangeRates.findOne({
    //   where: {
    //     [Op.or]: [{ baseCode: 'USD' }, { quoteCode: 'USD' }],
    //   },
    //   order: [['date', 'ASC']],
    //   attributes: ['date'],
    //   raw: true,
    // });

    // const newestRate = await ExchangeRates.findOne({
    //   where: {
    //     [Op.or]: [{ baseCode: 'USD' }, { quoteCode: 'USD' }],
    //   },
    //   order: [['date', 'DESC']],
    //   attributes: ['date'],
    //   raw: true,
    // });

    // if (!oldestRate || !newestRate) {
    //   throw new Error('No exchange rates found for USD');
    // }

    // const validDate = new Date(oldestRate.date);
    // validDate.setDate(validDate.getDate() + 1);

    // const futureDate = new Date(newestRate.date);
    // futureDate.setFullYear(futureDate.getFullYear() + 10);

    // const prices = [
    //   { price: 100, date: validDate.toISOString().split('T')[0]!, currency: 'USD' },
    //   { price: 200, date: futureDate.toISOString().split('T')[0]!, currency: 'USD' },
    // ];

    // const response = await helpers.bulkUploadSecurityPrices({
    //   payload: {
    //     searchResult,
    //     prices,
    //     autoFilter: true,
    //   },
    //   // raw: true,
    // });

    // console.log('response', response);

    // expect(response.summary.inserted).toBe(1);
    // expect(response.summary.duplicates).toBe(0);
    // expect(response.summary.filtered).toBe(1);

    // // Verify only valid price was inserted
    // const securityPrices = await SecurityPricing.findAll({
    //   where: { source: 'manual-upload' },
    // });

    // expect(securityPrices).toHaveLength(1);
    // expect(Number(securityPrices[0]!.priceClose)).toBe(100);
    // });

    it.todo('should create security from search result if it does not exist');
  });
});

describe('POST /investments/securities/price-upload-info', () => {
  let originalAdminUsers: string | undefined;

  beforeEach(async () => {
    originalAdminUsers = process.env.ADMIN_USERS;
    process.env.ADMIN_USERS = 'test1';
  });

  afterEach(() => {
    if (originalAdminUsers !== undefined) {
      process.env.ADMIN_USERS = originalAdminUsers;
    } else {
      delete process.env.ADMIN_USERS;
    }
  });

  describe('Authorization', () => {
    it('enforces the admin guard', async () => {
      delete process.env.ADMIN_USERS;
      const unconfigured = await helpers.getPriceUploadInfo({ payload: { currencyCode: 'USD' } });
      expect(unconfigured.statusCode).toBe(ERROR_CODES.Unauthorized);

      process.env.ADMIN_USERS = 'admin-user';
      const nonAdmin = await helpers.getPriceUploadInfo({ payload: { currencyCode: 'USD' } });
      expect(nonAdmin.statusCode).toBe(ERROR_CODES.Unauthorized);

      process.env.ADMIN_USERS = 'test1';
      const admin = await helpers.getPriceUploadInfo({ payload: { currencyCode: 'USD' } });
      expect(admin.statusCode).not.toBe(ERROR_CODES.Unauthorized);
    }, 30000);
  });

  describe('Validation', () => {
    it('should validate currency code length', async () => {
      const response = await helpers.getPriceUploadInfo({
        payload: { currencyCode: 'US' },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('should return error for currency with no exchange rates', async () => {
      // Valid ISO code with no exchange rates seeded, so the request passes
      // schema validation and fails deeper on the missing rate lookup.
      const response = await helpers.getPriceUploadInfo({
        payload: { currencyCode: 'SSP' },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Success', () => {
    it('should return date range for valid currency', async () => {
      const response = await helpers.getPriceUploadInfo({
        payload: { currencyCode: 'USD' },
        raw: true,
      });

      expect(response.oldestDate).toBeTruthy();
      expect(response.newestDate).toBeTruthy();
      expect(response.currencyCode).toBe('USD');
      const expectedMinDate = exchangeRateProviderRegistry.getEarliestHistoricalDate();
      expect(expectedMinDate).not.toBeNull();
      expect(startOfDay(new Date(response.minAllowedDate))).toEqual(startOfDay(expectedMinDate!));

      // Verify dates are in correct order
      expect(new Date(response.oldestDate).getTime()).toBeLessThanOrEqual(new Date(response.newestDate).getTime());
    });

    it('should return consistent date range across multiple calls', async () => {
      const firstResponse = await helpers.getPriceUploadInfo({
        payload: { currencyCode: 'USD' },
        raw: true,
      });

      const secondResponse = await helpers.getPriceUploadInfo({
        payload: { currencyCode: 'USD' },
        raw: true,
      });

      expect(firstResponse.oldestDate).toEqual(secondResponse.oldestDate);
      expect(firstResponse.newestDate).toEqual(secondResponse.newestDate);
    });
  });

  it.todo('works correctl when tries to update existing dates w/out override box enabled');
});
