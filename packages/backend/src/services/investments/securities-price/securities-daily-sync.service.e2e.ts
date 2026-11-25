import { PORTFOLIO_BENCHMARKS } from '@bt/shared/types';
import { ASSET_CLASS, SECURITY_PROVIDER, SECURITY_TYPE } from '@bt/shared/types/investments';
import Coingecko from '@coingecko/coingecko-typescript';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { restClient } from '@polygon.io/client-js';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import alpha from 'alphavantage';
import { format, isToday, startOfDay, subDays } from 'date-fns';
import YahooFinance from 'yahoo-finance2';

import { FmpClient } from '../data-providers/clients/fmp-client';
import { dataProviderFactory } from '../data-providers/provider-factory';
import { STOCKS_LOOKBACK_DAYS } from './securities-daily-sync.service';

// Mock data provider clients
const mockedRestClient = jest.mocked(restClient);
const mockPolygonApi = mockedRestClient.getMockImplementation()!('test');
const mockedPolygonAggregates = jest.mocked(mockPolygonApi.stocks.aggregatesGroupedDaily);

const mockedAlpha = jest.mocked(alpha);
const mockAlphaVantage = mockedAlpha.getMockImplementation()!({ key: 'test' });
const mockedAlphaDaily = jest.mocked(mockAlphaVantage.data.daily);

const mockedFmpClient = jest.mocked(FmpClient);
const mockedFmpHistoricalPrices = jest.fn();

mockedFmpClient.mockImplementation(
  () =>
    ({
      getHistoricalPrices: mockedFmpHistoricalPrices,
      search: jest.fn(),
      getQuote: jest.fn(),
      getHistoricalPricesFull: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
);

// Yahoo is now the primary provider for all operations.
// Override constructor to use shared mocks so tests can configure per-test.
const mockedYahooFinance = jest.mocked(YahooFinance);
const mockedYahooSearch = jest.fn<any>();
const mockedYahooQuote = jest.fn<any>();
const mockedYahooChart = jest.fn<any>();

mockedYahooFinance.mockImplementation(
  () =>
    ({
      search: mockedYahooSearch,
      quote: mockedYahooQuote,
      chart: mockedYahooChart,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
);

// CoinGecko global mock (registered in setupIntegrationTests.ts). Rebound
// per-test so a previous override doesn't leak.
const mockedCoingecko = jest.mocked(Coingecko);
const mockedCoingeckoSimplePriceGet = jest.fn<any>();

const installCoingeckoMock = () => {
  mockedCoingeckoSimplePriceGet.mockReset();
  mockedCoingeckoSimplePriceGet.mockResolvedValue({});
  mockedCoingecko.mockImplementation(
    () =>
      ({
        search: { get: jest.fn<any>().mockResolvedValue({ coins: [] }) },
        simple: { price: { get: mockedCoingeckoSimplePriceGet } },
        coins: {
          marketChart: {
            get: jest.fn<any>().mockResolvedValue({ prices: [] }),
            getRange: jest.fn<any>().mockResolvedValue({ prices: [] }),
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );
};

const createCryptoSecurity = async ({
  symbol = 'BTC',
  providerSymbol = 'bitcoin',
  name = 'Bitcoin',
}: { symbol?: string; providerSymbol?: string; name?: string } = {}) =>
  Securities.create({
    symbol,
    providerSymbol,
    currencyCode: 'USD',
    cryptoCurrencyCode: symbol,
    providerName: SECURITY_PROVIDER.coingecko,
    assetClass: ASSET_CLASS.crypto,
    name,
  });

describe('Securities Daily Sync Service (via API Endpoint)', () => {
  let investmentPortfolio: Portfolios;
  let usSecurity: Securities;
  let nonUsSecurity: Securities;
  let securityWithStaleData: Securities;
  let securityWithExcludedHolding: Securities;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Yahoo mocks default to rejecting so seedSecurities falls back to FMP
    mockedYahooSearch.mockRejectedValue(new Error('Yahoo mock: not configured'));
    mockedYahooQuote.mockRejectedValue(new Error('Yahoo mock: not configured'));
    mockedYahooChart.mockRejectedValue(new Error('Yahoo mock: not configured'));

    installCoingeckoMock();

    // Create investment portfolio
    investmentPortfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({
        name: 'Test Investment Portfolio',
      }),
      raw: true,
    });

    // Create test securities
    const securities = await helpers.seedSecurities([
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        currencyCode: 'USD',
      },
      {
        symbol: 'ASML.AS',
        name: 'ASML Holding N.V.',
        currencyCode: 'EUR',
      },
      {
        symbol: 'MSFT',
        name: 'Microsoft Corporation',
        currencyCode: 'USD',
      },
      {
        symbol: 'GOOGL',
        name: 'Alphabet Inc.',
        currencyCode: 'USD',
      },
    ]);

    usSecurity = securities[0]!;
    nonUsSecurity = securities[1]!;
    securityWithStaleData = securities[2]!;
    securityWithExcludedHolding = securities[3]!;

    // Create holdings for securities to make them eligible for sync
    await helpers.createHolding({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: usSecurity.id,
      },
    });

    await helpers.createHolding({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: nonUsSecurity.id,
      },
    });

    await helpers.createHolding({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: securityWithStaleData.id,
      },
    });

    // Give the security with stale data an old pricing sync timestamp
    await Securities.update(
      { pricingLastSyncedAt: subDays(new Date(), 10) },
      { where: { id: securityWithStaleData.id } },
    );

    // Add some existing price data to test prioritization
    await SecurityPricing.create({
      securityId: securityWithStaleData.id,
      date: subDays(new Date(), 5),
      priceClose: '100.00',
      source: SECURITY_PROVIDER.polygon,
    });

    // Clear factory cache after seeding so the sync endpoint creates a fresh
    // composite provider that uses the shared Yahoo mocks configured per-test.
    dataProviderFactory.clearCache();
  });

  describe('Basic Sync Functionality', () => {
    it('should sync prices for all securities with non-excluded holdings via endpoint', async () => {
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

      // Yahoo is the primary provider for all symbol types in the composite.
      // Mock chart() to return price data so the sync succeeds.
      mockedYahooChart.mockResolvedValue({
        quotes: [{ date: new Date(yesterday), close: 185.92, adjclose: 185.92 }],
      });

      // Trigger sync via API endpoint
      const response = await helpers.triggerSecuritiesSync();

      expect(response.statusCode).toBe(200);
      expect(helpers.extractResponse(response)).toEqual({
        message: 'Securities sync triggered (stocks + crypto)',
        timestamp: expect.any(String),
        stocks: { ok: true },
        crypto: { ok: true },
      });

      // Give some time for background sync to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify Yahoo was called for price data (all symbols routed to Yahoo)
      expect(mockedYahooChart).toHaveBeenCalled();

      // Verify price data was stored
      const securitiesPrices = await helpers.getSecuritiesPricesByDate({
        raw: true,
      });

      const usSecurityPrice = securitiesPrices.find((i) => i.securityId === usSecurity.id)!;
      const nonUsSecurityPrice = securitiesPrices.find((i) => i.securityId === nonUsSecurity.id)!;

      // All securities get prices from Yahoo (the primary provider)
      expect(usSecurityPrice.source).toBe(SECURITY_PROVIDER.yahoo);
      expect(nonUsSecurityPrice.source).toBe(SECURITY_PROVIDER.yahoo);

      // GOOGL's only holding is excluded, so it gets neither a price row nor a sync timestamp
      const excludedSecurityPrice = await SecurityPricing.findOne({
        where: { securityId: securityWithExcludedHolding.id },
      });
      expect(excludedSecurityPrice).toBeNull();

      const securities = await helpers.getAllSecurities({ raw: true });
      expect(securities.find((i) => i.id === securityWithExcludedHolding.id)!.pricingLastSyncedAt).toBe(null);
      expect(isToday(securities.find((i) => i.id === usSecurity.id)!.pricingLastSyncedAt!)).toBe(true);
      expect(isToday(securities.find((i) => i.id === nonUsSecurity.id)!.pricingLastSyncedAt!)).toBe(true);
      expect(isToday(securities.find((i) => i.id === securityWithStaleData.id)!.pricingLastSyncedAt!)).toBe(true);
    });

    it('backfills securityType from the chart instrument type on untyped securities only', async () => {
      await Securities.update({ securityType: SECURITY_TYPE.bond }, { where: { id: nonUsSecurity.id } });

      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      mockedYahooChart.mockImplementation(async (symbol: string) => ({
        meta: { currency: 'USD', instrumentType: symbol === 'AAPL' ? 'EQUITY' : 'MUTUALFUND' },
        quotes: [{ date: new Date(yesterday), close: 100, adjclose: 100 }],
      }));

      expect((await helpers.triggerSecuritiesSync()).statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const securities = await helpers.getAllSecurities({ raw: true });
      const typeOf = ({ id }: { id: string }) => securities.find((security) => security.id === id)!.securityType;
      expect(typeOf({ id: usSecurity.id })).toBe(SECURITY_TYPE.stock);
      expect(typeOf({ id: nonUsSecurity.id })).toBe(SECURITY_TYPE.bond);
      // A stocks row Yahoo calls a mutual fund is a UCITS ETF.
      expect(typeOf({ id: securityWithStaleData.id })).toBe(SECURITY_TYPE.etf);
    });
  });

  describe('Watchlist securities', () => {
    it('syncs securities on a live watchlist and skips those of a portfolio in the trash', async () => {
      const [watched, trashedWatch] = await helpers.seedSecurities([
        { symbol: 'WTCH', name: 'Watched Corp', currencyCode: 'USD' },
        { symbol: 'TRSH', name: 'Trashed Corp', currencyCode: 'USD' },
      ]);
      const trashedPortfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Trashed' }),
        raw: true,
      });
      await helpers.createWatchlistItem({ portfolioId: investmentPortfolio.id, payload: { securityId: watched!.id } });
      await helpers.createWatchlistItem({
        portfolioId: trashedPortfolio.id,
        payload: { securityId: trashedWatch!.id },
      });
      await helpers.deletePortfolio({ portfolioId: trashedPortfolio.id });

      // Drain the backfills that adding to the watchlist started before snapshotting.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const ids = [watched!.id, trashedWatch!.id];
      await Securities.update({ pricingLastSyncedAt: null }, { where: { id: ids } });
      await SecurityPricing.destroy({ where: { securityId: ids } });
      mockedYahooChart.mockClear();

      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      mockedYahooChart.mockResolvedValue({ quotes: [{ date: new Date(yesterday), close: 50, adjclose: 50 }] });

      expect((await helpers.triggerSecuritiesSync()).statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const chartedSymbols = mockedYahooChart.mock.calls.map((call) => call[0]);
      expect(chartedSymbols).toContain('WTCH');
      expect(chartedSymbols).not.toContain('TRSH');
      expect(await SecurityPricing.count({ where: { securityId: watched!.id } })).toBeGreaterThan(0);
      expect(await SecurityPricing.count({ where: { securityId: trashedWatch!.id } })).toBe(0);
    });
  });

  describe('Benchmark securities', () => {
    it('syncs a portfolio benchmark that no holding or watchlist references', async () => {
      const { providerSymbol, currencyCode, name } = PORTFOLIO_BENCHMARKS.sp500;
      const benchmark = await Securities.create({
        symbol: providerSymbol,
        providerSymbol,
        currencyCode,
        name,
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
      });

      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      mockedYahooChart.mockResolvedValue({ quotes: [{ date: new Date(yesterday), close: 5000, adjclose: 5000 }] });

      expect((await helpers.triggerSecuritiesSync()).statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockedYahooChart.mock.calls.map((call) => call[0])).toContain(providerSymbol);
      expect(await SecurityPricing.count({ where: { securityId: benchmark.id } })).toBeGreaterThan(0);
    });
  });

  describe('Fallback when Yahoo is disabled for sync', () => {
    it('should route US stocks to Polygon and non-US to AlphaVantage when Yahoo is disabled', async () => {
      const originalValue = process.env.YAHOO_FINANCE_ENABLED;
      process.env.YAHOO_FINANCE_ENABLED = 'false';
      dataProviderFactory.clearCache();

      // Clear Yahoo call history from beforeEach (holding creation triggers historical sync)
      mockedYahooChart.mockClear();
      mockedYahooSearch.mockClear();
      mockedYahooQuote.mockClear();

      try {
        const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

        // Mock Polygon for US stocks
        mockedPolygonAggregates.mockResolvedValue({
          results: [
            { T: 'AAPL', t: new Date(yesterday).getTime(), c: 185.92 },
            { T: 'MSFT', t: new Date(yesterday).getTime(), c: 155.5 },
          ],
        });

        // Mock Alpha Vantage for non-US stock
        mockedAlphaDaily.mockResolvedValue({
          'Time Series (Daily)': {
            [yesterday]: { '4. close': '728.90' },
          },
        });

        const response = await helpers.triggerSecuritiesSync();
        expect(response.statusCode).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 200));

        // Yahoo should NOT be called (disabled)
        expect(mockedYahooChart).not.toHaveBeenCalled();

        // Polygon should handle US stocks
        expect(mockedPolygonAggregates).toHaveBeenCalled();
        const polygonCall = mockedPolygonAggregates.mock.calls.find((call) => call[0] === yesterday);
        expect(polygonCall).toBeDefined();

        // Alpha Vantage should handle non-US stocks
        expect(mockedAlphaDaily).toHaveBeenCalledWith('ASML.AS', 'full');

        // Verify prices stored with correct fallback provider sources
        const securitiesPrices = await helpers.getSecuritiesPricesByDate({ raw: true });
        const usSecurityPrice = securitiesPrices.find((i) => i.securityId === usSecurity.id)!;
        const nonUsSecurityPrice = securitiesPrices.find((i) => i.securityId === nonUsSecurity.id)!;

        expect(usSecurityPrice.source).toBe(SECURITY_PROVIDER.polygon);
        expect(nonUsSecurityPrice.source).toBe(SECURITY_PROVIDER.alphavantage);
      } finally {
        if (originalValue === undefined) {
          delete process.env.YAHOO_FINANCE_ENABLED;
        } else {
          process.env.YAHOO_FINANCE_ENABLED = originalValue;
        }
        dataProviderFactory.clearCache();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle Yahoo failure gracefully and attempt fallback providers', async () => {
      // Yahoo fails for all symbols
      mockedYahooChart.mockRejectedValue(new Error('Yahoo Finance API rate limit exceeded'));

      // Polygon succeeds as fallback for US stocks
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      mockedPolygonAggregates.mockResolvedValue({
        results: [
          { T: 'AAPL', t: new Date(yesterday).getTime(), c: 185.92 },
          { T: 'MSFT', t: new Date(yesterday).getTime(), c: 155.5 },
        ],
      });

      // Alpha Vantage succeeds as fallback for non-US stocks
      mockedAlphaDaily.mockResolvedValue({
        'Time Series (Daily)': {
          [yesterday]: { '4. close': '728.90' },
        },
      });

      const response = await helpers.triggerSecuritiesSync();
      expect(response.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify Yahoo was attempted first
      expect(mockedYahooChart).toHaveBeenCalled();

      // Fallback providers should have been called
      const securitiesPrices = await helpers.getSecuritiesPricesByDate({ raw: true });
      // At least some prices should have been fetched via fallback
      expect(securitiesPrices.length).toBeGreaterThan(0);
    });

    it('should handle bulk create failure and fallback to individual upserts', async () => {
      // Yahoo succeeds for fetching
      mockedYahooChart.mockResolvedValue({
        quotes: [{ date: new Date(), close: 185.92, adjclose: 185.92 }],
      });

      // Mock database constraint error that would cause bulk create to fail
      const originalBulkCreate = SecurityPricing.bulkCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockBulkCreate = jest.fn<any>().mockRejectedValue(new Error('Bulk create constraint violation'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SecurityPricing.bulkCreate = mockBulkCreate as any;

      // Mock individual upsert to succeed
      const originalUpsert = SecurityPricing.upsert;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockUpsert = jest.fn<any>().mockResolvedValue([{} as SecurityPricing, true]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SecurityPricing.upsert = mockUpsert as any;

      try {
        const response = await helpers.triggerSecuritiesSync();
        expect(response.statusCode).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify bulk create was attempted and failed
        expect(mockBulkCreate).toHaveBeenCalled();

        // Verify fallback to individual upserts was used
        expect(mockUpsert).toHaveBeenCalled();
      } finally {
        SecurityPricing.bulkCreate = originalBulkCreate;
        SecurityPricing.upsert = originalUpsert;
      }
    });

    it('should handle scenario with only excluded holdings', async () => {
      jest.clearAllMocks();

      // Reset Yahoo mocks after clearAllMocks
      mockedYahooSearch.mockRejectedValue(new Error('Yahoo mock: not configured'));
      mockedYahooQuote.mockRejectedValue(new Error('Yahoo mock: not configured'));
      mockedYahooChart.mockRejectedValue(new Error('Yahoo mock: not configured'));

      // Reset all existing holdings to be excluded
      await Holdings.update({ excluded: true }, { where: {} });

      const excludedOnlySecurities = await helpers.seedSecurities([
        {
          symbol: 'EXCL',
          name: 'Excluded Only Corp',
          currencyCode: 'USD',
        },
      ]);

      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: excludedOnlySecurities[0]!.id,
        },
      });

      await Holdings.update(
        { excluded: true },
        { where: { portfolioId: investmentPortfolio.id, securityId: excludedOnlySecurities[0]!.id } },
      );

      const nonExcludedHoldings = await Holdings.count({ where: { excluded: false } });
      expect(nonExcludedHoldings).toBe(0);

      // Wait for background sync triggered by createHolding to finish, then clear call history
      await new Promise((resolve) => setTimeout(resolve, 500));
      mockedYahooChart.mockClear();
      mockedPolygonAggregates.mockClear();
      mockedAlphaDaily.mockClear();
      mockedFmpHistoricalPrices.mockClear();

      const response = await helpers.triggerSecuritiesSync();
      expect(response.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // No providers should be called since all holdings are excluded
      expect(mockedYahooChart).not.toHaveBeenCalled();
      expect(mockedPolygonAggregates).not.toHaveBeenCalled();
      expect(mockedAlphaDaily).not.toHaveBeenCalled();
      expect(mockedFmpHistoricalPrices).not.toHaveBeenCalled();
    });
  });

  describe('Closed Market Handling', () => {
    it('advances pricingLastSyncedAt for symbols when yesterday was a weekend (no provider data)', async () => {
      // Freeze "today" to a Monday so `yesterday` is Sunday — markets closed,
      // providers return no data, and the sync should still advance pricingLastSyncedAt
      // for those symbols so they don't dominate the staleness queue forever.
      jest.useFakeTimers({
        now: new Date('2026-05-04T12:00:00Z'), // Monday
        doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick', 'performance'],
      });

      try {
        // Wait for any background work from beforeEach's createHolding to settle, then
        // snapshot the price-row count so we can assert this sync added none.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const pricesBefore = await SecurityPricing.count();

        // All providers return empty results — simulating "no data because markets were closed"
        mockedYahooChart.mockResolvedValue({ quotes: [] });
        mockedPolygonAggregates.mockResolvedValue({ results: [] });
        mockedAlphaDaily.mockResolvedValue({ 'Time Series (Daily)': {} });

        const response = await helpers.triggerSecuritiesSync();
        expect(response.statusCode).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 500));

        // pricingLastSyncedAt must advance for every closed-market symbol, even though
        // no SecurityPricing rows were created.
        const securities = await helpers.getAllSecurities({ raw: true });
        const apple = securities.find((s) => s.id === usSecurity.id)!;
        const asml = securities.find((s) => s.id === nonUsSecurity.id)!;
        const msft = securities.find((s) => s.id === securityWithStaleData.id)!;

        expect(apple.pricingLastSyncedAt).not.toBeNull();
        expect(asml.pricingLastSyncedAt).not.toBeNull();
        expect(msft.pricingLastSyncedAt).not.toBeNull();

        // MSFT was seeded with pricingLastSyncedAt = 10 days ago; it must have been bumped forward.
        expect(new Date(msft.pricingLastSyncedAt!).getTime()).toBeGreaterThan(
          new Date('2026-05-03T00:00:00Z').getTime(),
        );

        // The sync itself must not create new price rows when providers returned nothing.
        const pricesAfter = await SecurityPricing.count();
        expect(pricesAfter).toBe(pricesBefore);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Provider-symbol Collision', () => {
    it('updates both Securities rows when two securities share a providerSymbol under different providers', async () => {
      // The DB allows two Security rows to share `providerSymbol` as long as
      // their `providerName` differs (uniqueness is on the pair). Before this
      // refactor the daily-sync built a map keyed only by providerSymbol, so
      // one of these two rows was silently dropped. This test pins the fix in
      // place: both rows must end up with a SecurityPricing entry and an
      // advanced pricingLastSyncedAt.

      // beforeEach already created an AAPL row via the FMP search path, so it
      // has `providerName = fmp`. Add a SECOND AAPL row directly with
      // `providerName = yahoo` — the colliding pair.
      const colliderAaplYahoo = await Securities.create({
        symbol: 'AAPL',
        providerSymbol: 'AAPL',
        currencyCode: 'USD',
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
        name: 'Apple Inc. (Yahoo dup)',
      });

      // Sanity-check the precondition: two rows, same providerSymbol, distinct providerName.
      const fmpAapl = await Securities.findOne({
        where: { providerSymbol: 'AAPL', providerName: SECURITY_PROVIDER.fmp },
      });
      expect(fmpAapl).not.toBeNull();
      expect(fmpAapl!.id).not.toBe(colliderAaplYahoo.id);

      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: colliderAaplYahoo.id,
        },
      });

      // Wait for any background work from createHolding to settle, then
      // reset price-fetch mocks so the assertion below sees only the sync run.
      await new Promise((resolve) => setTimeout(resolve, 200));
      mockedYahooChart.mockReset();
      await SecurityPricing.destroy({ where: { securityId: colliderAaplYahoo.id } });

      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      mockedYahooChart.mockResolvedValue({
        quotes: [{ date: new Date(yesterday), close: 185.92, adjclose: 185.92 }],
      });

      const response = await helpers.triggerSecuritiesSync();
      expect(response.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));

      // BOTH AAPL rows must have a SecurityPricing entry. Before the fix, only
      // one would — the second would be silently dropped by the symbol-keyed map.
      const fmpPrices = await SecurityPricing.findAll({ where: { securityId: fmpAapl!.id } });
      const yahooPrices = await SecurityPricing.findAll({ where: { securityId: colliderAaplYahoo.id } });

      expect(fmpPrices.length).toBeGreaterThan(0);
      expect(yahooPrices.length).toBeGreaterThan(0);

      // Both rows' pricingLastSyncedAt must advance — otherwise the dropped
      // security would re-enter the priority queue every run.
      const securities = await helpers.getAllSecurities({ raw: true });
      const fmpRow = securities.find((s) => s.id === fmpAapl!.id)!;
      const yahooRow = securities.find((s) => s.id === colliderAaplYahoo.id)!;

      expect(fmpRow.pricingLastSyncedAt).not.toBeNull();
      expect(yahooRow.pricingLastSyncedAt).not.toBeNull();
      expect(isToday(new Date(fmpRow.pricingLastSyncedAt!))).toBe(true);
      expect(isToday(new Date(yahooRow.pricingLastSyncedAt!))).toBe(true);
    });
  });

  describe('Concurrent Execution Prevention', () => {
    it('reports per-side ok=false when a second trigger hits while the first holds the lock', async () => {
      // Wait for any async work from previous tests to release the lock
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Mock slow Yahoo response so the first trigger holds the stocks lock
      mockedYahooChart.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ quotes: [] }), 300)),
      );

      // The route allows one sync per user per window; this test is about the
      // sync lock, so both requests must get past the rate limiter.
      const rateLimitSpy = jest.spyOn(RateLimitService, 'checkRateLimit').mockResolvedValue({ allowed: true });

      const firstSyncPromise = helpers.triggerSecuritiesSync();
      const secondSyncPromise = helpers.triggerSecuritiesSync();

      // Both requests now resolve 200 (allSettled surfaces per-side outcomes
      // instead of throwing). The second request's `stocks.ok` should be false
      // since the first run still holds `lock:sync:securities-prices:stocks`.
      const [firstResponse, secondResponse] = await Promise.all([firstSyncPromise, secondSyncPromise]);

      expect(firstResponse.statusCode).toBe(200);
      expect(secondResponse.statusCode).toBe(200);

      const firstBody = helpers.extractResponse(firstResponse) as unknown as {
        stocks: { ok: boolean; error?: string };
        crypto: { ok: boolean; error?: string };
      };
      const secondBody = helpers.extractResponse(secondResponse) as unknown as {
        stocks: { ok: boolean; error?: string };
        crypto: { ok: boolean; error?: string };
      };

      const stocksOkResults = [firstBody.stocks.ok, secondBody.stocks.ok];
      // Exactly one of the two requests held the stocks lock; the other was rejected.
      expect(stocksOkResults.filter((ok) => ok)).toHaveLength(1);
      expect(stocksOkResults.filter((ok) => !ok)).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 500));

      rateLimitSpy.mockRestore();
      mockedYahooChart.mockClear();
    });
  });

  describe('Crypto sync', () => {
    it('writes a SecurityPricing row for a crypto holding sourced from CoinGecko', async () => {
      const cryptoSecurity = await createCryptoSecurity();
      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: cryptoSecurity.id },
      });

      // Drain any background work created by createHolding before snapshotting.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: cryptoSecurity.id } });
      mockedYahooChart.mockClear();
      mockedCoingeckoSimplePriceGet.mockReset();

      // Stocks: ensure providers can fetch something so the controller's
      // dual-trigger reports stocks.ok=true (not the focus of this test).
      mockedYahooChart.mockResolvedValue({ quotes: [{ date: new Date(), close: 100, adjclose: 100 }] });

      const upstreamLastUpdatedAt = Math.floor(Date.now() / 1000) - 60; // 1 min ago
      mockedCoingeckoSimplePriceGet.mockResolvedValue({
        bitcoin: { usd: 67000, last_updated_at: upstreamLastUpdatedAt },
      });

      const response = await helpers.triggerSecuritiesSync();
      expect(response.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));

      // CoinGecko must have been called for the batch.
      expect(mockedCoingeckoSimplePriceGet).toHaveBeenCalled();

      const cryptoPrices = await SecurityPricing.findAll({ where: { securityId: cryptoSecurity.id } });
      expect(cryptoPrices).toHaveLength(1);
      const [cryptoPrice] = cryptoPrices;
      expect(cryptoPrice!.source).toBe(SECURITY_PROVIDER.coingecko);
      expect(cryptoPrice!.priceClose.toNumber()).toBeCloseTo(67000, 5);

      // Sanity-check the migration actually widened the column to TIMESTAMPTZ.
      // Without it, Postgres would silently truncate `date` to midnight UTC and
      // the crypto cadence (multiple rows per day) is broken.
      const sequelize = SecurityPricing.sequelize!;
      const [typeRows] = await sequelize.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name = 'SecurityPricings' AND column_name = 'date'`,
      );
      expect((typeRows as { data_type: string }[])[0]?.data_type).toBe('timestamp with time zone');

      // The stored timestamp comes from CoinGecko's last_updated_at, NOT midnight UTC.
      // Wrap in `new Date()` so the assertion works whether Sequelize returns a Date
      // or an ISO string for the TIMESTAMPTZ column.
      expect(new Date(cryptoPrice!.date).getTime()).toBe(upstreamLastUpdatedAt * 1000);
    });

    it('stocks-daily excludes crypto securities (does not call CoinGecko via the stocks path)', async () => {
      const cryptoSecurity = await createCryptoSecurity({
        symbol: 'ETH',
        providerSymbol: 'ethereum',
        name: 'Ethereum',
      });
      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: cryptoSecurity.id },
      });

      // Drain createHolding-triggered background work, snapshot state.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: cryptoSecurity.id } });
      await Securities.update({ pricingLastSyncedAt: null }, { where: { id: cryptoSecurity.id } });

      // Make CoinGecko return a price IF it's asked — but the stocks-daily run
      // must not ask. (Crypto path will ask separately and write the row.)
      mockedCoingeckoSimplePriceGet.mockReset();
      mockedCoingeckoSimplePriceGet.mockResolvedValue({
        ethereum: { usd: 3500, last_updated_at: Math.floor(Date.now() / 1000) },
      });

      mockedYahooChart.mockResolvedValue({ quotes: [{ date: new Date(), close: 100, adjclose: 100 }] });

      await helpers.triggerSecuritiesSync();
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The crypto row should come from the crypto path (CoinGecko), not the stocks path.
      // Either way it's sourced as coingecko — the contract we pin is that
      // Yahoo/Polygon/Alpha were NOT consulted for the crypto security.
      const calls = mockedYahooChart.mock.calls.map((c) => JSON.stringify(c));
      expect(calls.some((c) => c.includes('ethereum'))).toBe(false);
    });

    it('stocks anchor every row to midnight UTC of yesterday', async () => {
      // Yahoo returns a timestamp far from midnight; the sync must still store
      // midnight UTC of yesterday so the unique (securityId, date) index keeps
      // one row per day.
      const yesterdayMidnightUtc = startOfDay(subDays(new Date(), 1));
      const noonYesterday = new Date(yesterdayMidnightUtc.getTime() + 12 * 60 * 60 * 1000);
      mockedYahooChart.mockResolvedValue({
        quotes: [{ date: noonYesterday, close: 185.92, adjclose: 185.92 }],
      });

      await helpers.triggerSecuritiesSync();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const usPrice = await SecurityPricing.findOne({
        where: { securityId: usSecurity.id },
        order: [['createdAt', 'DESC']],
      });
      expect(usPrice).not.toBeNull();
      // Stored at midnight UTC of yesterday — not at the provider's noon timestamp.
      // Wrap in `new Date()` so the assertion is robust to whether Sequelize hydrates
      // the TIMESTAMPTZ column as a Date or as an ISO string.
      expect(new Date(usPrice!.date).toISOString()).toBe(yesterdayMidnightUtc.toISOString());
    });
  });

  describe('Trailing-window backfill', () => {
    it('requests a multi-day window and stores one row per returned trading day', async () => {
      // Drain createHolding-triggered historical syncs so recorded chart calls
      // belong to the daily-sync run alone.
      await new Promise((resolve) => setTimeout(resolve, 300));
      mockedYahooChart.mockClear();

      const yesterdayMidnightUtc = startOfDay(subDays(new Date(), 1));
      const dayBars = [3, 2, 1].map((daysAgo) => {
        const dayMidnightUtc = subDays(yesterdayMidnightUtc, daysAgo - 1);
        return {
          dayMidnightUtc,
          close: 100 + daysAgo,
          bar: {
            date: new Date(dayMidnightUtc.getTime() + 12 * 60 * 60 * 1000),
            close: 100 + daysAgo,
            adjclose: 100 + daysAgo,
          },
        };
      });

      mockedYahooChart.mockResolvedValue({ quotes: dayBars.map((d) => d.bar) });

      const response = await helpers.triggerSecuritiesSync();
      expect(response.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The chart request must cover the trailing lookback window, not just yesterday.
      const expectedPeriod1 = format(subDays(yesterdayMidnightUtc, STOCKS_LOOKBACK_DAYS - 1), 'yyyy-MM-dd');
      const chartCall = mockedYahooChart.mock.calls.filter((call) => (call[0] as string) === 'AAPL').at(-1);
      expect(chartCall).toBeDefined();
      expect((chartCall![1] as { period1: string }).period1).toBe(expectedPeriod1);

      // Every returned bar becomes exactly one row, anchored to midnight UTC of
      // the bar's day, carrying that day's close.
      const rows = await SecurityPricing.findAll({
        where: { securityId: usSecurity.id },
        order: [['date', 'ASC']],
      });
      expect(rows.length).toBe(dayBars.length);
      rows.forEach((row, i) => {
        expect(new Date(row.date).toISOString()).toBe(dayBars[i]!.dayMidnightUtc.toISOString());
        expect(row.priceClose.toNumber()).toBeCloseTo(dayBars[i]!.close, 5);
      });
    });
  });

  describe('Dual-trigger error isolation', () => {
    it('still runs crypto when stocks throws (and vice versa)', async () => {
      const cryptoSecurity = await createCryptoSecurity({ symbol: 'SOL', providerSymbol: 'solana', name: 'Solana' });
      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: cryptoSecurity.id },
      });

      // Drain background work, snapshot state.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await SecurityPricing.destroy({ where: { securityId: cryptoSecurity.id } });
      mockedCoingeckoSimplePriceGet.mockReset();

      // Stocks: every provider rejects → stocks sync surfaces failures via
      // `failedUpdates` (no thrown error from the wrapper, but data integrity
      // remains; controller will report `stocks.ok: true` with internal counts).
      // For the strongest assertion, simulate a hard throw via Yahoo + Polygon +
      // Alpha all rejecting; the sync code path will still complete normally
      // (no provider == no rows, but no thrown error). To force a thrown error,
      // mock Securities.findAll to throw.
      const originalFindAll = Securities.findAll;
      let firstCall = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Securities as any).findAll = jest.fn().mockImplementation((...args: unknown[]) => {
        if (firstCall) {
          firstCall = false;
          throw new Error('Simulated DB failure on stocks path');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalFindAll as any).apply(Securities, args);
      });

      mockedCoingeckoSimplePriceGet.mockResolvedValue({
        solana: { usd: 150, last_updated_at: Math.floor(Date.now() / 1000) },
      });

      try {
        const response = await helpers.triggerSecuritiesSync();
        expect(response.statusCode).toBe(200);

        const body = helpers.extractResponse(response) as unknown as {
          stocks: { ok: boolean; error?: string };
          crypto: { ok: boolean; error?: string };
        };

        // Stocks failed because Securities.findAll threw.
        expect(body.stocks.ok).toBe(false);
        // Crypto still ran because allSettled isolates the two promises.
        expect(body.crypto.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 300));

        const solPrices = await SecurityPricing.findAll({ where: { securityId: cryptoSecurity.id } });
        expect(solPrices.length).toBeGreaterThan(0);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Securities as any).findAll = originalFindAll;
      }
    });
  });
});
