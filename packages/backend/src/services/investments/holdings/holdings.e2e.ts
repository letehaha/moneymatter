import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { logger } from '@js/utils';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { restClient } from '@polygon.io/client-js';
import { dataProviderFactory } from '@services/investments/data-providers/provider-factory';
import * as helpers from '@tests/helpers';
import { makeRequest } from '@tests/helpers/common';
import alpha from 'alphavantage';
import YahooFinance from 'yahoo-finance2';

const mockedRestClient = jest.mocked(restClient);
const mockApi = mockedRestClient.getMockImplementation()!('test');
const mockedAggregates = jest.mocked(mockApi.stocks.aggregates);

const mockedYahooFinance = jest.mocked(YahooFinance);
const mockedAlpha = jest.mocked(alpha);
const mockAlphaVantage = mockedAlpha.getMockImplementation()!({ key: 'test' });
const mockedAlphaDaily = jest.mocked(mockAlphaVantage.data.daily);

describe('Investment holdings', () => {
  let investmentPortfolio: Portfolios;
  let vooSecurity: Securities;

  beforeEach(async () => {
    jest.clearAllMocks();

    investmentPortfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({
        name: 'Test Investment Portfolio',
      }),
      raw: true,
    });

    const seededSecurities = await helpers.seedSecurities([{ symbol: 'VOO', name: 'Vanguard S&P 500 ETF' }]);
    const firstSecurity = seededSecurities[0];
    if (!firstSecurity) throw new Error('VOO security not found after seeding');
    vooSecurity = firstSecurity;
  });

  describe('DELETE /investments/holding (delete holding)', () => {
    it('should delete a holding successfully', async () => {
      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });
      const response = await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(200);
    });

    it('should fail to delete a non-existent holding', async () => {
      const response = await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(200); // No error, idempotent
    });

    it('should fail to delete holding with non-zero quantity', async () => {
      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });
      await Holdings.update(
        { quantity: '1.0000000000' },
        { where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id } },
      );
      const response = await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.NotAllowed);
    });

    it('force-deletes holding with active position and cascades to its transactions', async () => {
      // Seed a second security so we can verify other holdings' transactions are untouched
      const seededSecurities = await helpers.seedSecurities([{ symbol: 'AAPL', name: 'Apple Inc.' }]);
      const aaplSecurity = seededSecurities[0];
      if (!aaplSecurity) throw new Error('AAPL security not found after seeding');

      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: aaplSecurity.id },
      });

      const vooBuy = await helpers.createInvestmentTransaction({
        payload: helpers.buildInvestmentTransactionPayload({
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          quantity: '10',
          price: '100',
        }),
        raw: true,
      });
      const aaplBuy = await helpers.createInvestmentTransaction({
        payload: helpers.buildInvestmentTransactionPayload({
          portfolioId: investmentPortfolio.id,
          securityId: aaplSecurity.id,
          quantity: '5',
          price: '50',
        }),
        raw: true,
      });

      const vooHoldingBefore = await Holdings.findOne({
        where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      expect(vooHoldingBefore).not.toBeNull();
      expect(vooHoldingBefore!.quantity.isZero()).toBe(false);

      // Force-delete VOO holding (would fail without force due to active position)
      const response = await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          force: true,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(200);

      const vooHoldingAfter = await Holdings.findOne({
        where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      expect(vooHoldingAfter).toBeNull();
      const vooTxnsAfter = await InvestmentTransaction.findAll({
        where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      expect(vooTxnsAfter).toHaveLength(0);

      const aaplHoldingAfter = await Holdings.findOne({
        where: { portfolioId: investmentPortfolio.id, securityId: aaplSecurity.id },
      });
      expect(aaplHoldingAfter).not.toBeNull();
      const aaplTxnsAfter = await InvestmentTransaction.findAll({
        where: { portfolioId: investmentPortfolio.id, securityId: aaplSecurity.id },
      });
      expect(aaplTxnsAfter).toHaveLength(1);
      expect(aaplTxnsAfter[0]!.id).toBe(aaplBuy.id);

      const remainingVooTxn = await InvestmentTransaction.findByPk(vooBuy.id);
      expect(remainingVooTxn).toBeNull();
    });

    it('force-delete restores portfolio cash to pre-purchase state', async () => {
      const currencyCode = vooSecurity.currencyCode;
      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      await helpers.updatePortfolioBalance({
        portfolioId: investmentPortfolio.id,
        currencyCode,
        setAvailableCash: '10000',
        setTotalCash: '10000',
      });

      await helpers.createInvestmentTransaction({
        payload: helpers.buildInvestmentTransactionPayload({
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '500',
          fees: '5',
        }),
        raw: true,
      });

      const [balanceAfterBuy] = await helpers.getPortfolioBalance({
        portfolioId: investmentPortfolio.id,
        currencyCode,
        raw: true,
      });
      expect(balanceAfterBuy!.availableCash).toBeNumericEqual(4995); // 10000 - (10*500 + 5)
      expect(balanceAfterBuy!.totalCash).toBeNumericEqual(4995);

      await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          force: true,
        },
        raw: false,
      });

      const [balanceAfterDelete] = await helpers.getPortfolioBalance({
        portfolioId: investmentPortfolio.id,
        currencyCode,
        raw: true,
      });
      expect(balanceAfterDelete!.availableCash).toBeNumericEqual(10000);
      expect(balanceAfterDelete!.totalCash).toBeNumericEqual(10000);
    });

    it('force-delete cascades when quantity nets to zero from paired buy + sell', async () => {
      await helpers.createHolding({
        payload: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });

      await helpers.createInvestmentTransaction({
        payload: helpers.buildInvestmentTransactionPayload({
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '100',
        }),
        raw: true,
      });
      await helpers.createInvestmentTransaction({
        payload: helpers.buildInvestmentTransactionPayload({
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '10',
          price: '110',
        }),
        raw: true,
      });

      const holdingBefore = await Holdings.findOne({
        where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      expect(holdingBefore!.quantity.isZero()).toBe(true);

      const response = await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          force: true,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(200);

      const holdingAfter = await Holdings.findOne({
        where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      expect(holdingAfter).toBeNull();
      const txnsAfter = await InvestmentTransaction.findAll({
        where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
      });
      expect(txnsAfter).toHaveLength(0);
    });

    it('force-delete is idempotent when holding does not exist', async () => {
      const response = await helpers.deleteHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
          force: true,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(200);
    });

    it('fails if required fields are missing', async () => {
      const payloadMissingPortfolioId = { securityId: vooSecurity.id } as unknown as Parameters<
        typeof helpers.deleteHolding
      >[0]['payload'];
      let response = await helpers.deleteHolding({
        payload: payloadMissingPortfolioId,
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const payloadMissingSecurityId = { portfolioId: investmentPortfolio.id } as unknown as Parameters<
        typeof helpers.deleteHolding
      >[0]['payload'];
      response = await helpers.deleteHolding({
        payload: payloadMissingSecurityId,
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('POST /investments/holding (create holding)', () => {
    it('should create a holding successfully', async () => {
      const response = await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });

      expect(response.statusCode).toBe(201);

      const holding = await Holdings.findOne({
        where: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });

      expect(holding).toBeTruthy();
      expect(holding?.quantity).toBeNumericEqual(0);
      expect(holding?.costBasis).toBeNumericEqual(0);
      expect(holding?.currencyCode).toBe(vooSecurity.currencyCode);
    });

    it('should fail to create a holding for non-existent portfolio', async () => {
      const response = await helpers.createHolding({
        payload: {
          portfolioId: generateRandomRecordId(),
          securityId: vooSecurity.id,
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('should fail to create a holding for non-existent security', async () => {
      const response = await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: generateRandomRecordId(),
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('should fail to create a duplicate holding', async () => {
      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });

      const response = await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
    });

    it('fails if required fields are missing', async () => {
      const payloadMissingPortfolioId = { securityId: vooSecurity.id } as unknown as Parameters<
        typeof helpers.createHolding
      >[0]['payload'];

      let response = await helpers.createHolding({
        payload: payloadMissingPortfolioId,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const payloadMissingSecurityId = { portfolioId: investmentPortfolio.id } as unknown as Parameters<
        typeof helpers.createHolding
      >[0]['payload'];

      response = await helpers.createHolding({
        payload: payloadMissingSecurityId,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('background sync is not called on duplicate', async () => {
      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
      });

      await helpers.sleep(200); // sync is triggered in background, so we need to wait for it to clear

      mockedAggregates.mockClear();

      const response = await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
        raw: false,
      });
      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(mockedAggregates).not.toHaveBeenCalled();
    });

    it('correctly sets all default values', async () => {
      mockedAggregates.mockResolvedValue({
        results: [{ c: 123, t: new Date().getTime() }],
      });
      const holding = await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: vooSecurity.id,
        },
        raw: true,
      });
      expect(holding.quantity).toBeNumericEqual(0);
      expect(holding.costBasis).toBeNumericEqual(0);
      expect(holding.refCostBasis).toBeNumericEqual(0);
      expect(typeof holding.currencyCode).toBe('string');
      expect(holding.portfolioId).toBe(investmentPortfolio.id);
      expect(holding.securityId).toBe(vooSecurity.id);
    });

    it('rejects searchResult with unsupported asset class (e.g. crypto)', async () => {
      const response = await makeRequest({
        method: 'post',
        url: '/investments/holding',
        payload: {
          portfolioId: investmentPortfolio.id,
          searchResult: {
            symbol: 'BTC-USD',
            name: 'Bitcoin USD',
            assetClass: ASSET_CLASS.crypto,
            providerName: SECURITY_PROVIDER.yahoo,
            currencyCode: 'USD',
            exchangeName: 'CCC',
            exchangeAcronym: 'CCC',
          },
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const created = await Securities.findOne({ where: { symbol: 'BTC-USD' } });
      expect(created).toBeNull();
    });

    it.todo('prevents race condition on duplicate (only one succeeds)');

    it('stores pence-quoted LSE (GBp) prices as pounds', async () => {
      dataProviderFactory.clearCache();
      const mockedYahooChart = jest.fn<any>().mockResolvedValue({
        meta: { currency: 'GBp' },
        quotes: [{ date: new Date('2024-01-15'), close: 4082, adjclose: 4082 }],
      });
      mockedYahooFinance.mockImplementation(
        () =>
          ({
            search: jest.fn<any>().mockRejectedValue(new Error('not configured')),
            quote: jest.fn<any>().mockRejectedValue(new Error('not configured')),
            chart: mockedYahooChart,
          }) as any,
      );

      const response = await makeRequest({
        method: 'post',
        url: '/investments/holding',
        payload: {
          portfolioId: investmentPortfolio.id,
          searchResult: {
            symbol: 'EMIM.L',
            providerSymbol: 'EMIM.L',
            name: 'iShares Core MSCI EM IMI',
            assetClass: ASSET_CLASS.stocks,
            providerName: SECURITY_PROVIDER.yahoo,
            currencyCode: 'GBp',
          },
        },
      });
      expect(response.statusCode).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const stored = await Securities.findOne({ where: { symbol: 'EMIM.L' } });
      const price = await SecurityPricing.findOne({ where: { securityId: stored!.id } });
      expect(price?.priceClose.toNumber()).toBeCloseTo(40.82, 5);
    });

    describe('searchResult with priceSourceSymbol (Yahoo ISIN fallback path)', () => {
      it('persists priceSourceSymbol on the new security and routes initial price fetch through it', async () => {
        // The latest-price fetch must read the local ticker (priceSourceSymbol),
        // not the sparse ISIN-suffix listing.
        const mockedYahooQuote = jest.fn<any>().mockResolvedValue({
          symbol: 'MEUD.PA',
          regularMarketPreviousClose: 92.5,
          regularMarketTime: Math.floor(Date.now() / 1000),
        });
        const mockedYahooChart = jest.fn<any>().mockResolvedValue({
          quotes: [{ date: new Date('2024-01-15'), close: 92.5, adjclose: 92.5 }],
        });
        mockedYahooFinance.mockImplementation(
          () =>
            ({
              search: jest.fn<any>().mockRejectedValue(new Error('not configured')),
              quote: mockedYahooQuote,
              chart: mockedYahooChart,
            }) as any,
        );

        const response = await makeRequest({
          method: 'post',
          url: '/investments/holding',
          payload: {
            portfolioId: investmentPortfolio.id,
            searchResult: {
              symbol: 'IE00B53L3W79.IR',
              providerSymbol: 'IE00B53L3W79.IR',
              priceSourceSymbol: 'MEUD.PA',
              name: 'iShares Core EURO STOXX 50',
              assetClass: ASSET_CLASS.stocks,
              providerName: SECURITY_PROVIDER.yahoo,
              currencyCode: 'EUR',
              isin: 'IE00B53L3W79',
            },
          },
        });

        expect(response.statusCode).toBe(201);

        const stored = await Securities.findOne({ where: { providerSymbol: 'IE00B53L3W79.IR' } });
        expect(stored).toBeTruthy();
        expect(stored?.symbol).toBe('IE00B53L3W79.IR');
        expect(stored?.providerSymbol).toBe('IE00B53L3W79.IR');
        expect(stored?.priceSourceSymbol).toBe('MEUD.PA');
        expect(stored?.priceQuerySymbol).toBe('MEUD.PA');
        expect(stored?.currencyCode).toBe('EUR');

        expect(mockedYahooQuote).toHaveBeenCalledWith('MEUD.PA');
        const quoteSymbols = mockedYahooQuote.mock.calls.map((c) => c[0]);
        expect(quoteSymbols).not.toContain('IE00B53L3W79.IR');
      });

      it('ignores explicit null priceSourceSymbol via client (Zod strips it)', async () => {
        // Zod schema is .optional() (not .nullable()): sending null is treated
        // as a validation rejection at the boundary, preventing a client from
        // silently wiping a previously-stored priceSourceSymbol on re-add.
        const response = await makeRequest({
          method: 'post',
          url: '/investments/holding',
          payload: {
            portfolioId: investmentPortfolio.id,
            searchResult: {
              symbol: 'AAPL',
              providerSymbol: 'AAPL',
              priceSourceSymbol: null,
              name: 'Apple Inc.',
              assetClass: ASSET_CLASS.stocks,
              providerName: SECURITY_PROVIDER.yahoo,
              currencyCode: 'USD',
            },
          },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });
    });

    describe('searchResult for a security that already exists', () => {
      it("keeps the stored security's metadata when another user sends altered fields, and still adds the holding", async () => {
        const attacker = await helpers.provisionSecondUserWithBaseCurrency();

        const response = await helpers.asUser({
          cookies: attacker.cookies,
          fn: async () => {
            const attackerPortfolio = await helpers.createPortfolio({
              payload: helpers.buildPortfolioPayload({ name: 'Attacker portfolio' }),
              raw: true,
            });
            return makeRequest({
              method: 'post',
              url: '/investments/holding',
              payload: {
                portfolioId: attackerPortfolio.id,
                searchResult: {
                  symbol: 'VOO',
                  providerSymbol: 'VOO',
                  priceSourceSymbol: 'NOT-A-REAL-SYMBOL',
                  name: 'Altered name',
                  assetClass: ASSET_CLASS.stocks,
                  providerName: SECURITY_PROVIDER.fmp,
                  currencyCode: 'USD',
                  exchangeName: 'Altered exchange',
                  exchangeAcronym: 'ALT',
                  exchangeMic: 'ALTM',
                  logoUrl: 'https://attacker.example/logo.png',
                },
              },
            });
          },
        });

        expect(response.statusCode).toBe(201);

        const stored = await Securities.findAll({ where: { symbol: 'VOO' } });
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
          id: vooSecurity.id,
          name: vooSecurity.name,
          priceSourceSymbol: null,
          logoUrl: null,
          exchangeName: vooSecurity.exchangeName,
          exchangeAcronym: vooSecurity.exchangeAcronym,
          exchangeMic: vooSecurity.exchangeMic,
        });

        const holdings = await Holdings.findAll({ where: { securityId: vooSecurity.id } });
        expect(holdings).toHaveLength(1);
      });

      it("fetches the first price through the stored security's provider and symbol, not the ones in the request", async () => {
        const mockedYahooQuote = jest.fn<any>().mockResolvedValue({
          symbol: 'MEUD.PA',
          regularMarketPreviousClose: 92.5,
          regularMarketTime: Math.floor(Date.now() / 1000),
        });
        mockedYahooFinance.mockImplementation(
          () =>
            ({
              search: jest.fn<any>().mockRejectedValue(new Error('not configured')),
              quote: mockedYahooQuote,
              chart: jest.fn<any>().mockResolvedValue({ quotes: [] }),
            }) as any,
        );
        dataProviderFactory.clearCache();

        const seeded = await Securities.create({
          symbol: 'IE00B53L3W79.IR',
          providerSymbol: 'IE00B53L3W79.IR',
          priceSourceSymbol: 'MEUD.PA',
          name: 'iShares Core EURO STOXX 50',
          currencyCode: 'EUR',
          providerName: SECURITY_PROVIDER.yahoo,
          assetClass: ASSET_CLASS.stocks,
        });

        const response = await makeRequest({
          method: 'post',
          url: '/investments/holding',
          payload: {
            portfolioId: investmentPortfolio.id,
            searchResult: {
              symbol: 'IE00B53L3W79.IR',
              providerSymbol: 'IE00B53L3W79.IR',
              priceSourceSymbol: 'EVIL.PA',
              name: 'iShares Core EURO STOXX 50',
              assetClass: ASSET_CLASS.stocks,
              providerName: SECURITY_PROVIDER.fmp,
              currencyCode: 'EUR',
            },
          },
        });
        expect(response.statusCode).toBe(201);

        const quotedSymbols = mockedYahooQuote.mock.calls.map((call) => call[0]);
        expect(quotedSymbols).toContain('MEUD.PA');
        expect(quotedSymbols).not.toContain('EVIL.PA');

        const reloaded = await Securities.findByPk(seeded.id);
        expect(reloaded?.priceSourceSymbol).toBe('MEUD.PA');
      });
    });

    describe('cross-provider duplicate detection (symbol+currencyCode dedup)', () => {
      it('rejects adding an existing holding when the new searchResult comes from a different provider', async () => {
        // The duplicate-detection key must treat providerName='fmp' and
        // providerName='yahoo' rows for the same providerSymbol as one logical
        // security; otherwise addSecurityFromSearch creates a second Securities
        // row and createHolding's (portfolioId, securityId) check lets the
        // duplicate through.
        const initialResponse = await helpers.createHolding({
          payload: {
            portfolioId: investmentPortfolio.id,
            securityId: vooSecurity.id,
          },
        });
        expect(initialResponse.statusCode).toBe(201);
        await helpers.sleep(100);

        const response = await makeRequest({
          method: 'post',
          url: '/investments/holding',
          payload: {
            portfolioId: investmentPortfolio.id,
            searchResult: {
              symbol: 'VOO',
              providerSymbol: 'VOO',
              name: 'Vanguard S&P 500 ETF',
              assetClass: ASSET_CLASS.stocks,
              providerName: SECURITY_PROVIDER.yahoo,
              currencyCode: 'USD',
            },
          },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ConflictError);

        const vooSecurities = await Securities.findAll({ where: { symbol: 'VOO' } });
        expect(vooSecurities).toHaveLength(1);

        const holdings = await Holdings.findAll({
          where: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id },
        });
        expect(holdings).toHaveLength(1);
      });
    });

    describe('background historical price sync error surfacing (MONEY-MATTER-BACKEND-6M)', () => {
      it('surfaces the real provider cause instead of "Unknown error" when every price provider fails', async () => {
        const symbol = 'IE00BLCHJB90.SG';

        // This symbol shape matches no US/European suffix, so it routes to Yahoo
        // (primary) with Alpha Vantage as the only fallback.
        const security = await Securities.create({
          symbol,
          providerSymbol: symbol,
          name: 'Test Global ETF',
          currencyCode: 'EUR',
          providerName: SECURITY_PROVIDER.yahoo,
          assetClass: ASSET_CLASS.stocks,
        });

        mockedYahooFinance.mockImplementation(
          () =>
            ({
              search: jest.fn<any>().mockRejectedValue(new Error('not configured')),
              quote: jest.fn<any>().mockRejectedValue(new Error('not configured')),
              chart: jest.fn<any>().mockRejectedValue(new Error('Yahoo: no data for symbol')),
            }) as any,
        );

        // The real `alphavantage` package rejects with a bare string rather than
        // an Error; the handler must still produce a readable message.
        mockedAlphaDaily.mockRejectedValue(
          'An AlphaVantage error occurred. Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for TIME_SERIES_DAILY.',
        );

        // dataProviderFactory caches the composite/Yahoo client on first
        // getProvider(); an earlier test may have baked in a stale Yahoo mock, so
        // clear it to force a fresh client for this test's background sync.
        dataProviderFactory.clearCache();

        const errorSpy = jest.spyOn(logger, 'error');

        const response = await helpers.createHolding({
          payload: {
            portfolioId: investmentPortfolio.id,
            securityId: security.id,
          },
        });

        // Price sync runs fire-and-forget after the transaction commits, so a
        // single bad ticker never fails holding creation itself.
        expect(response.statusCode).toBe(201);

        await helpers.sleep(300); // let the background sync's rejection land

        const calls = errorSpy.mock.calls as unknown as Array<[{ message?: string; error?: Error }]>;
        const syncFailureCall = calls.find(([arg]) => arg?.message?.includes(`securityId: ${security.id}`));
        expect(syncFailureCall).toBeTruthy();

        const surfacedMessage = syncFailureCall?.[0].error?.message ?? '';
        expect(surfacedMessage).toContain(symbol);
        expect(surfacedMessage).toContain('alphavantage');
        expect(surfacedMessage).toContain('Invalid API call');
        expect(surfacedMessage).not.toContain('Unknown error');

        errorSpy.mockRestore();
      });
    });
  });
});
