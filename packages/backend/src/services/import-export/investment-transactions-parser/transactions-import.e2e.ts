import { AI_FEATURE, type RecordId } from '@bt/shared/types';
import {
  ASSET_CLASS,
  INVESTMENT_IMPORT_SIDE_SKIP,
  INVESTMENT_TRANSACTION_CATEGORY,
  type InvestmentColumnMapping,
  SECURITY_PROVIDER,
} from '@bt/shared/types/investments';
import Coingecko from '@coingecko/coingecko-typescript';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { t } from '@i18n/index';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Securities from '@models/investments/securities.model';
import { FALLBACK_SERVER_MODELS } from '@services/ai/resolution-ladder';
import * as helpers from '@tests/helpers';
import { GEMINI_API_URL, VALID_GEMINI_API_KEY, rejectIfWrongModel } from '@tests/mocks/gemini/mock-api';
import { HttpResponse, http } from 'msw';

import { dataProviderFactory } from '../../../services/investments/data-providers/provider-factory';
import { DUPLICATE_DATE_WINDOW_DAYS } from './detect-duplicates.service';

/**
 * Direct DB insert of a crypto Security row. Used by tests that need an
 * existing crypto holding the AI's symbol resolver can latch onto — the
 * shared `helpers.seedSecurities` goes through FMP (stocks-only).
 */
async function createCryptoSecurity({
  symbol,
  name,
  providerSymbol,
}: {
  symbol: string;
  name: string;
  providerSymbol: string;
}) {
  return Securities.create({
    symbol,
    name,
    providerSymbol,
    providerName: SECURITY_PROVIDER.coingecko,
    assetClass: ASSET_CLASS.crypto,
    currencyCode: 'USD',
    cryptoCurrencyCode: symbol,
    exchangeName: 'CoinGecko',
    isBrokerageCash: false,
  });
}

/**
 * Build a single CSV row in the format the AI prompt asks for.
 * symbol,name,date,side,quantity,price,fees,currency,assetClassHint,confidence
 */
const csvRow = ({
  symbol,
  name = '',
  date,
  side,
  quantity,
  price,
  fees = '0',
  currency = 'USDT',
  assetClassHint = 'crypto',
  confidence = 95,
}: {
  symbol: string;
  name?: string;
  date: string;
  side: 'B' | 'S';
  quantity: string;
  price: string;
  fees?: string;
  currency?: string;
  assetClassHint?: 'crypto' | 'stocks';
  confidence?: number;
}) => `${symbol},${name},${date},${side},${quantity},${price},${fees},${currency},${assetClassHint},${confidence}`;

/** The model the investment-import CSV extraction is actually configured to call. */
const EXPECTED_GEMINI_MODEL = FALLBACK_SERVER_MODELS[AI_FEATURE.investmentTransactionsParsing].model;

/**
 * MSW handler that returns a fixed CSV from Gemini's generateContent endpoint.
 * The Vercel AI SDK with `createGoogleGenerativeAI({ apiKey })` calls
 * https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
 */
function geminiCsvHandler({ csv }: { csv: string }) {
  return http.post(GEMINI_API_URL, ({ request }) => {
    const modelMismatch = rejectIfWrongModel({ request, expectedModel: EXPECTED_GEMINI_MODEL });
    if (modelMismatch) return modelMismatch;

    return HttpResponse.json({
      candidates: [
        {
          content: { parts: [{ text: csv }], role: 'model' },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 60, totalTokenCount: 260 },
    });
  });
}

/** Encode a string source file as base64 for the upload endpoint. */
function encodeFile({ text }: { text: string }): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

/** Shift a YYYY-MM-DD string by `days`. UTC-anchored to avoid DST drift. */
function addDays({ date, days }: { date: string; days: number }): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reference values for the date-window dedup cases: quantity * price = 2100.
 * An imported row with a different quantity must adjust price to keep that amount.
 */
const DEDUP_BASE_DATE = '2024-01-15';
const DEDUP_BASE_QUANTITY = '0.05';
const DEDUP_BASE_PRICE = '42000';

/**
 * The security must be CRYPTO with providerSymbol 'bitcoin': resolveSymbols
 * matches on `(assetClass=crypto, symbol='BTC')`, and dedup only queries that
 * securityId.
 */
async function seedBtcDedupState() {
  const portfolio = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
    raw: true,
  });

  const btc = await createCryptoSecurity({ symbol: 'BTC', name: 'Bitcoin', providerSymbol: 'bitcoin' });
  await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: btc.id } });
  await helpers.createInvestmentTransaction({
    payload: {
      portfolioId: portfolio.id,
      securityId: btc.id,
      category: INVESTMENT_TRANSACTION_CATEGORY.buy,
      date: DEDUP_BASE_DATE,
      quantity: DEDUP_BASE_QUANTITY,
      price: DEDUP_BASE_PRICE,
    },
  });

  return portfolio;
}

async function extractBtcDedupRow({
  portfolioId,
  dayOffset,
  side = 'B',
  importedQuantity = DEDUP_BASE_QUANTITY,
  importedPrice = DEDUP_BASE_PRICE,
  fees,
}: {
  portfolioId: RecordId;
  dayOffset: number;
  side?: 'B' | 'S';
  importedQuantity?: string;
  importedPrice?: string;
  fees?: string;
}) {
  installCoingeckoMock({
    coins: [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1 }],
  });

  const importedDate = addDays({ date: DEDUP_BASE_DATE, days: dayOffset });
  const csv = csvRow({
    symbol: 'BTC',
    date: importedDate,
    side,
    quantity: importedQuantity,
    price: importedPrice,
    fees,
  });
  global.mswMockServer.use(geminiCsvHandler({ csv }));

  const result = await helpers.investmentImportExtract({
    payload: {
      fileBase64: encodeFile({
        text: `BTC ${side} ${dayOffset} days from base (qty=${importedQuantity}, px=${importedPrice})`,
      }),
      defaultPortfolioId: portfolioId,
    },
    raw: true,
  });

  return result.holdings[0]!.transactions[0]!.possibleDuplicateOf;
}

const mockedCoingecko = jest.mocked(Coingecko);

/** Install a CoinGecko mock that returns the given coin list for any search. */
function installCoingeckoMock({
  coins,
}: {
  coins: Array<{ id: string; symbol: string; name: string; market_cap_rank: number }>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchGet = jest.fn<any>().mockResolvedValue({ coins });
  mockedCoingecko.mockImplementation(
    () =>
      ({
        search: { get: searchGet },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        simple: { price: { get: jest.fn<any>().mockResolvedValue({}) } },
        coins: {
          marketChart: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            get: jest.fn<any>().mockResolvedValue({ prices: [] }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            getRange: jest.fn<any>().mockResolvedValue({ prices: [] }),
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );
  return { searchGet };
}

describe('Investment transactions AI import — E2E', () => {
  let originalGeminiKey: string | undefined;

  beforeEach(() => {
    originalGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
    jest.clearAllMocks();
    dataProviderFactory.clearCache();
  });

  afterEach(() => {
    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
  });

  describe('extract', () => {
    it('resolves AI rows and groups them into one hierarchical holding per symbol', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      installCoingeckoMock({
        coins: [
          { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1 },
          { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2 },
        ],
      });

      const csv = [
        csvRow({ symbol: 'BTC', name: 'Bitcoin', date: '2024-01-15', side: 'B', quantity: '0.05', price: '42000' }),
        csvRow({ symbol: 'BTC', name: 'Bitcoin', date: '2024-02-20', side: 'S', quantity: '0.02', price: '50000' }),
        csvRow({ symbol: 'ETH', name: 'Ethereum', date: '2024-02-01', side: 'B', quantity: '1', price: '2300' }),
      ].join('\n');

      global.mswMockServer.use(geminiCsvHandler({ csv }));

      const result = await helpers.investmentImportExtract({
        payload: {
          fileBase64: encodeFile({ text: 'Binance export\nBTC 0.05 @ 42000 USDT on 2024-01-15\nETH 1 @ 2300' }),
          defaultPortfolioId: portfolio.id,
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(2);
      expect(result.holdings.map((h) => h.parsedSymbol).toSorted()).toEqual(['BTC', 'ETH']);

      const holding = result.holdings.find((h) => h.parsedSymbol === 'BTC')!;
      expect(holding.parsedSymbol).toBe('BTC');
      expect(holding.resolvedSecurity).toMatchObject({
        providerSymbol: 'bitcoin',
        symbol: 'BTC',
        alreadyInDb: false,
      });
      expect(holding.resolvedConfidence).toBe('auto');
      expect(holding.currencyCode).toBe('USD'); // USDT → USD
      expect(holding.portfolioId).toBe(portfolio.id);
      expect(holding.transactions).toHaveLength(2);
      expect(holding.transactions[0]!.side).toBe('buy');
      expect(holding.transactions[1]!.side).toBe('sell');
    });

    it('leaves the security unresolved when CoinGecko returns ambiguous matches', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      installCoingeckoMock({
        coins: [
          { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2 },
          { id: 'scam-eth', symbol: 'eth', name: 'Scam ETH', market_cap_rank: 99999 },
        ],
      });

      const csv = csvRow({ symbol: 'ETH', date: '2024-03-01', side: 'B', quantity: '1', price: '2000' });
      global.mswMockServer.use(geminiCsvHandler({ csv }));

      const result = await helpers.investmentImportExtract({
        payload: {
          fileBase64: encodeFile({ text: 'ETH 1 @ 2000 USDT' }),
          defaultPortfolioId: portfolio.id,
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0]!.resolvedSecurity).toBeNull();
      expect(result.holdings[0]!.resolvedConfidence).toBe('ambiguous');
    });

    it('resolves a stocks row against a pre-existing stocks holding', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Stocks' }),
        raw: true,
      });

      // Seed AAPL (FMP/stocks) and attach a holding so the resolver finds it
      // via the user's own securities in Step 1 — no provider lookup needed.
      const [aapl] = await helpers.seedSecurities([{ symbol: 'AAPL', name: 'Apple Inc.' }]);
      await helpers.createHolding({
        payload: { portfolioId: portfolio.id, securityId: aapl!.id },
      });

      const csv = csvRow({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        date: '2024-05-01',
        side: 'B',
        quantity: '10',
        price: '180.25',
        currency: 'USD',
        assetClassHint: 'stocks',
      });
      global.mswMockServer.use(geminiCsvHandler({ csv }));

      const result = await helpers.investmentImportExtract({
        payload: {
          fileBase64: encodeFile({ text: 'AAPL 10 @ 180.25 USD on 2024-05-01' }),
          defaultPortfolioId: portfolio.id,
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      const holding = result.holdings[0]!;
      expect(holding.parsedSymbol).toBe('AAPL');
      expect(holding.resolvedSecurity).toMatchObject({
        securityId: aapl!.id,
        symbol: 'AAPL',
        assetClass: ASSET_CLASS.stocks,
        alreadyInDb: true,
      });
      expect(holding.resolvedConfidence).toBe('auto');
      expect(holding.hasExistingHolding).toBe(true);
      expect(holding.currencyCode).toBe('USD');
    });

    it('fails without an AI key (NO_AI_CONFIGURED) and on an empty AI CSV (NO_TRANSACTIONS_FOUND)', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      delete process.env.GEMINI_API_KEY;

      const withoutKey = await helpers.investmentImportExtract({
        payload: {
          fileBase64: encodeFile({ text: 'BTC 0.05 @ 42000 USDT' }),
          defaultPortfolioId: portfolio.id,
        },
      });

      expect(withoutKey.statusCode).toBe(422);

      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
      installCoingeckoMock({ coins: [] });
      global.mswMockServer.use(geminiCsvHandler({ csv: '' }));

      const emptyCsv = await helpers.investmentImportExtract({
        payload: {
          fileBase64: encodeFile({ text: 'no transactions in here' }),
          defaultPortfolioId: portfolio.id,
        },
      });

      expect(emptyCsv.statusCode).toBe(422);
    });

    it('keeps currencyCode null and surfaces a warning when AI returns a crypto/crypto pair', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      installCoingeckoMock({
        coins: [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1 }],
      });

      // currency='' triggers normaliseCurrency() => null in the resolver.
      const csv = csvRow({ symbol: 'BTC', date: '2024-01-15', side: 'B', quantity: '0.1', price: '20', currency: '' });
      global.mswMockServer.use(geminiCsvHandler({ csv }));

      const result = await helpers.investmentImportExtract({
        payload: {
          fileBase64: encodeFile({ text: 'BTC 0.1 @ 20 ETH (crypto/crypto pair)' }),
          defaultPortfolioId: portfolio.id,
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0]!.currencyCode).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    // `extract` writes nothing, so every case below shares the one seeded BUY
    // and runs in any order. Offsets derive from DUPLICATE_DATE_WINDOW_DAYS, so
    // changing the window changes what is exercised with no edit here.
    it('flags possible duplicates only inside the symmetric date window, at the same side and unit price', async () => {
      const portfolio = await seedBtcDedupState();

      const sameDay = await extractBtcDedupRow({ portfolioId: portfolio.id, dayOffset: 0 });
      expect(sameDay).not.toBeNull();

      const windowLater = await extractBtcDedupRow({
        portfolioId: portfolio.id,
        dayOffset: DUPLICATE_DATE_WINDOW_DAYS,
      });
      expect(windowLater).not.toBeNull();

      const windowEarlier = await extractBtcDedupRow({
        portfolioId: portfolio.id,
        dayOffset: -DUPLICATE_DATE_WINDOW_DAYS,
      });
      expect(windowEarlier).not.toBeNull();

      const oneDayOff = await extractBtcDedupRow({ portfolioId: portfolio.id, dayOffset: 1 });
      expect(oneDayOff).not.toBeNull();

      const pastWindow = await extractBtcDedupRow({
        portfolioId: portfolio.id,
        dayOffset: DUPLICATE_DATE_WINDOW_DAYS + 1,
      });
      expect(pastWindow).toBeNull();

      const oppositeSide = await extractBtcDedupRow({ portfolioId: portfolio.id, dayOffset: 0, side: 'S' });
      expect(oppositeSide).toBeNull();

      // Unit price must match exactly even inside the window: 0.1 @ 21000 carries
      // the same 2100 amount as the seeded 0.05 @ 42000.
      const differentUnitPrice = await extractBtcDedupRow({
        portfolioId: portfolio.id,
        dayOffset: DUPLICATE_DATE_WINDOW_DAYS,
        importedQuantity: '0.1',
        importedPrice: '21000',
      });
      expect(differentUnitPrice).toBeNull();
    }, 120_000);

    it('flags an imported sell with fees as a duplicate of the stored sell (net amount on both sides)', async () => {
      const portfolio = await seedBtcDedupState();
      const btc = (await Securities.findOne({ where: { symbol: 'BTC' } }))!;

      // 0.05 * 42000 - 10 = 2090 stored and computed for the imported row.
      const sell = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: btc.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          date: DEDUP_BASE_DATE,
          quantity: DEDUP_BASE_QUANTITY,
          price: DEDUP_BASE_PRICE,
          fees: '10',
        },
        raw: true,
      });

      const duplicateOf = await extractBtcDedupRow({ portfolioId: portfolio.id, dayOffset: 0, side: 'S', fees: '10' });
      expect(duplicateOf).toBe(sell.id);
    }, 60_000);
  });

  describe('execute', () => {
    it('creates a new security, holding, and child transactions for an unresolved AI batch the user then resolved', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      installCoingeckoMock({ coins: [{ id: 'solana', symbol: 'sol', name: 'Solana', market_cap_rank: 5 }] });
      await helpers.searchSecurities({ payload: { query: 'SOL', assetClass: ASSET_CLASS.crypto }, raw: true });

      const result = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'holding-1',
              parsedSymbol: 'SOL',
              parsedName: 'Solana',
              resolvedSecurity: {
                securityId: null,
                providerSymbol: 'solana',
                symbol: 'SOL',
                name: 'Solana',
                assetClass: ASSET_CLASS.crypto,
                providerName: SECURITY_PROVIDER.coingecko,
                currencyCode: 'USD',
                cryptoCurrencyCode: 'SOL',
                exchangeName: 'CoinGecko',
                alreadyInDb: false,
              },
              resolvedConfidence: 'auto',
              portfolioId: portfolio.id,
              currencyCode: 'USD',
              hasExistingHolding: false,
              transactions: [
                {
                  tempId: 'tx-1',
                  date: '2024-04-01',
                  side: 'buy',
                  quantity: '10',
                  price: '95.5',
                  fees: '0',
                  amount: '955',
                  possibleDuplicateOf: null,
                },
                {
                  tempId: 'tx-2',
                  date: '2024-04-15',
                  side: 'sell',
                  quantity: '2',
                  price: '120',
                  fees: '0',
                  amount: '240',
                  possibleDuplicateOf: null,
                },
              ],
            },
          ],
          skipTempIds: [],
        },
        raw: true,
      });

      expect(result.createdSecurities).toBe(1);
      expect(result.createdHoldings).toBe(1);
      expect(result.mergedHoldings).toBe(0);
      expect(result.createdTransactions).toBe(2);

      // Verify the new security
      const sol = await Securities.findOne({ where: { providerSymbol: 'solana' } });
      expect(sol).toBeTruthy();
      expect(sol!.providerName).toBe(SECURITY_PROVIDER.coingecko);
      expect(sol!.assetClass).toBe(ASSET_CLASS.crypto);

      // Verify both transactions
      const txs = await InvestmentTransaction.findAll({ where: { securityId: sol!.id } });
      expect(txs).toHaveLength(2);
    });

    it('skips a holding whose security was never returned by a provider search', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      const result = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'holding-1',
              parsedSymbol: 'FORGED',
              parsedName: 'Forged Coin',
              resolvedSecurity: {
                securityId: null,
                providerSymbol: 'forged-coin',
                symbol: 'FORGED',
                name: 'Forged Coin',
                assetClass: ASSET_CLASS.crypto,
                providerName: SECURITY_PROVIDER.coingecko,
                currencyCode: 'USD',
                cryptoCurrencyCode: 'FORGED',
                exchangeName: 'CoinGecko',
                alreadyInDb: false,
              },
              resolvedConfidence: 'auto',
              portfolioId: portfolio.id,
              currencyCode: 'USD',
              hasExistingHolding: false,
              transactions: [
                {
                  tempId: 'tx-1',
                  date: '2024-04-01',
                  side: 'buy',
                  quantity: '10',
                  price: '1',
                  fees: '0',
                  amount: '10',
                  possibleDuplicateOf: null,
                },
              ],
            },
          ],
          skipTempIds: [],
        },
        raw: true,
      });

      expect(result.createdSecurities).toBe(0);
      expect(result.createdTransactions).toBe(0);
      expect(result.skippedHoldings).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        code: 'HOLDING_SETUP_FAILED',
        params: {
          symbol: 'FORGED',
          reason: t({ key: 'investments.securitySearchResultNotRecognized', locale: 'en' }),
        },
      });

      expect(await Securities.findOne({ where: { providerSymbol: 'forged-coin' } })).toBeNull();
    });

    it('merges new transactions into an existing holding', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      const [btc] = await helpers.seedSecurities([{ symbol: 'BTC', name: 'Bitcoin' }]);
      await helpers.createHolding({
        payload: { portfolioId: portfolio.id, securityId: btc!.id },
      });
      // Pre-existing transaction (will not be touched).
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: btc!.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          date: '2024-01-01',
          quantity: '0.1',
          price: '40000',
        },
      });

      const result = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'holding-1',
              parsedSymbol: 'BTC',
              parsedName: 'Bitcoin',
              resolvedSecurity: {
                securityId: btc!.id,
                providerSymbol: btc!.providerSymbol,
                symbol: 'BTC',
                name: 'Bitcoin',
                assetClass: btc!.assetClass,
                providerName: btc!.providerName,
                currencyCode: btc!.currencyCode,
                exchangeName: btc!.exchangeName ?? undefined,
                cryptoCurrencyCode: btc!.cryptoCurrencyCode ?? undefined,
                alreadyInDb: true,
              },
              resolvedConfidence: 'auto',
              portfolioId: portfolio.id,
              currencyCode: btc!.currencyCode,
              hasExistingHolding: false,
              transactions: [
                {
                  tempId: 'tx-1',
                  date: '2024-02-01',
                  side: 'buy',
                  quantity: '0.05',
                  price: '45000',
                  fees: '0',
                  amount: '2250',
                  possibleDuplicateOf: null,
                },
              ],
            },
          ],
          skipTempIds: [],
        },
        raw: true,
      });

      expect(result.createdSecurities).toBe(0);
      expect(result.createdHoldings).toBe(0);
      expect(result.mergedHoldings).toBe(1);
      expect(result.createdTransactions).toBe(1);

      // Original transaction should still be there.
      const txs = await InvestmentTransaction.findAll({ where: { securityId: btc!.id }, order: [['date', 'ASC']] });
      expect(txs).toHaveLength(2);
    });

    it('imports dividend rows as cash income and still rejects fee rows', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Dividends' }),
        raw: true,
      });
      const [btc] = await helpers.seedSecurities([{ symbol: 'BTC', name: 'Bitcoin' }]);
      await helpers.createHolding({
        payload: { portfolioId: portfolio.id, securityId: btc!.id },
      });

      const buildPayload = ({ side, price, amount }: { side: 'dividend' | 'fee'; price: string; amount: string }) => ({
        holdings: [
          {
            tempId: 'holding-1',
            parsedSymbol: 'BTC',
            parsedName: 'Bitcoin',
            resolvedSecurity: {
              securityId: btc!.id,
              providerSymbol: btc!.providerSymbol,
              symbol: 'BTC',
              name: 'Bitcoin',
              assetClass: btc!.assetClass,
              providerName: btc!.providerName,
              currencyCode: btc!.currencyCode,
              exchangeName: btc!.exchangeName ?? undefined,
              cryptoCurrencyCode: btc!.cryptoCurrencyCode ?? undefined,
              alreadyInDb: true,
            },
            resolvedConfidence: 'auto' as const,
            portfolioId: portfolio.id,
            currencyCode: btc!.currencyCode,
            hasExistingHolding: true,
            transactions: [
              {
                tempId: `tx-${side}`,
                date: '2024-02-01',
                side,
                quantity: '10',
                price,
                fees: '0',
                amount,
                possibleDuplicateOf: null,
              },
            ],
          },
        ],
        skipTempIds: [],
      });

      const result = await helpers.investmentImportExecute({
        payload: buildPayload({ side: 'dividend', price: '0.5', amount: '5' }),
        raw: true,
      });
      expect(result.createdTransactions).toBe(1);
      expect(result.failedTransactions).toBe(0);

      const feeResponse = await helpers.investmentImportExecute({
        payload: buildPayload({ side: 'fee', price: '3', amount: '30' }),
      });
      expect(feeResponse.statusCode).not.toBe(200);

      const txs = await InvestmentTransaction.findAll({ where: { securityId: btc!.id } });
      expect(txs).toHaveLength(1);
      expect(txs[0]!.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.dividend);

      const [balance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: btc!.currencyCode,
        raw: true,
      });
      expect(balance!.availableCash).toBeNumericEqual(5);
    });

    it('skips transactions that the user marked as duplicates via skipTempIds', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      const [btc] = await helpers.seedSecurities([{ symbol: 'BTC', name: 'Bitcoin' }]);

      const result = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'h-1',
              parsedSymbol: 'BTC',
              parsedName: 'Bitcoin',
              resolvedSecurity: {
                securityId: btc!.id,
                providerSymbol: btc!.providerSymbol,
                symbol: 'BTC',
                name: 'Bitcoin',
                assetClass: btc!.assetClass,
                providerName: btc!.providerName,
                currencyCode: btc!.currencyCode,
                exchangeName: btc!.exchangeName ?? undefined,
                cryptoCurrencyCode: btc!.cryptoCurrencyCode ?? undefined,
                alreadyInDb: true,
              },
              resolvedConfidence: 'auto',
              portfolioId: portfolio.id,
              currencyCode: btc!.currencyCode,
              hasExistingHolding: false,
              transactions: [
                {
                  tempId: 'keep',
                  date: '2024-01-15',
                  side: 'buy',
                  quantity: '0.1',
                  price: '42000',
                  fees: '0',
                  amount: '4200',
                  possibleDuplicateOf: null,
                },
                {
                  tempId: 'skip-me',
                  date: '2024-01-16',
                  side: 'buy',
                  quantity: '0.1',
                  price: '42000',
                  fees: '0',
                  amount: '4200',
                  possibleDuplicateOf: 'whatever',
                },
              ],
            },
          ],
          skipTempIds: ['skip-me'],
        },
        raw: true,
      });

      expect(result.createdTransactions).toBe(1);
      expect(result.skippedPossibleDuplicates).toBe(1);
    });

    it('rejects an unresolved row, a row with no currencyCode, and two rows picking the same security', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });

      const [btc] = await helpers.seedSecurities([{ symbol: 'BTC', name: 'Bitcoin' }]);

      const resolvedBtc = {
        securityId: btc!.id,
        providerSymbol: btc!.providerSymbol,
        symbol: 'BTC',
        name: 'Bitcoin',
        assetClass: btc!.assetClass,
        providerName: btc!.providerName,
        currencyCode: btc!.currencyCode,
        exchangeName: btc!.exchangeName ?? undefined,
        cryptoCurrencyCode: btc!.cryptoCurrencyCode ?? undefined,
        alreadyInDb: true,
      };

      const transaction = {
        tempId: 'tx-1',
        date: '2024-01-15',
        side: 'buy' as const,
        quantity: '0.1',
        price: '42000',
        fees: '0',
        amount: '4200',
        possibleDuplicateOf: null,
      };

      const unresolvedSecurity = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'h-1',
              parsedSymbol: 'BTC',
              parsedName: null,
              resolvedSecurity: null,
              resolvedConfidence: 'unmapped',
              portfolioId: portfolio.id,
              currencyCode: 'USD',
              hasExistingHolding: false,
              transactions: [transaction],
            },
          ],
          skipTempIds: [],
        },
      });

      expect(unresolvedSecurity.statusCode).not.toBe(200);

      const missingCurrency = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'h-1',
              parsedSymbol: 'BTC',
              parsedName: null,
              resolvedSecurity: resolvedBtc,
              resolvedConfidence: 'auto',
              portfolioId: portfolio.id,
              currencyCode: null,
              hasExistingHolding: false,
              transactions: [transaction],
            },
          ],
          skipTempIds: [],
        },
      });

      expect(missingCurrency.statusCode).not.toBe(200);

      const baseHolding = {
        parsedSymbol: 'BTC',
        parsedName: 'Bitcoin',
        resolvedSecurity: resolvedBtc,
        resolvedConfidence: 'auto' as const,
        portfolioId: portfolio.id,
        currencyCode: btc!.currencyCode,
        hasExistingHolding: false,
      };

      const duplicateSecurity = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            { tempId: 'h-1', ...baseHolding, transactions: [{ ...transaction, tempId: 'tx-1' }] },
            { tempId: 'h-2', ...baseHolding, transactions: [{ ...transaction, tempId: 'tx-2' }] },
          ],
          skipTempIds: [],
        },
      });

      expect(duplicateSecurity.statusCode).not.toBe(200);
    }, 60_000);

    it('surfaces a warning and skippedHoldings count when the portfolio is unknown', async () => {
      // Create one portfolio that belongs to the test user, then send a holding
      // pointing at a *different* portfolioId (a real UUID that's not theirs).
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Crypto' }),
        raw: true,
      });
      void portfolio;

      const [btc] = await helpers.seedSecurities([{ symbol: 'BTC', name: 'Bitcoin' }]);

      const fakePortfolioId = generateRandomRecordId();

      const result = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            {
              tempId: 'h-1',
              parsedSymbol: 'BTC',
              parsedName: null,
              resolvedSecurity: {
                securityId: btc!.id,
                providerSymbol: btc!.providerSymbol,
                symbol: 'BTC',
                name: 'Bitcoin',
                assetClass: btc!.assetClass,
                providerName: btc!.providerName,
                currencyCode: btc!.currencyCode,
                exchangeName: btc!.exchangeName ?? undefined,
                cryptoCurrencyCode: btc!.cryptoCurrencyCode ?? undefined,
                alreadyInDb: true,
              },
              resolvedConfidence: 'auto',
              portfolioId: fakePortfolioId,
              currencyCode: btc!.currencyCode,
              hasExistingHolding: false,
              transactions: [
                {
                  tempId: 'tx-1',
                  date: '2024-01-15',
                  side: 'buy',
                  quantity: '0.1',
                  price: '42000',
                  fees: '0',
                  amount: '4200',
                  possibleDuplicateOf: null,
                },
              ],
            },
          ],
          skipTempIds: [],
        },
        raw: true,
      });

      expect(result.createdTransactions).toBe(0);
      expect(result.skippedHoldings).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('imports a multi-holding batch with zero-price rows and a negative-going crypto position', async () => {
      // Three patterns that previously broke the import pipeline:
      //   - zero-price SELL  (lost / burned tokens — proceeds = 0)
      //   - zero-price BUY   (staking reward / airdrop — basis untouched)
      //   - long → short → still-short  (crypto drift: basis must stay zero)
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Yahoo import' }),
        raw: true,
      });

      const coin02 = await createCryptoSecurity({ symbol: 'COIN02', name: 'Coin Two', providerSymbol: 'coin-02' });
      const coin04 = await createCryptoSecurity({ symbol: 'COIN04', name: 'Coin Four', providerSymbol: 'coin-04' });
      const coin05 = await createCryptoSecurity({ symbol: 'COIN05', name: 'Coin Five', providerSymbol: 'coin-05' });

      const buildHolding = ({
        tempId,
        security,
        transactions,
      }: {
        tempId: string;
        security: Securities;
        transactions: Array<{
          tempId: string;
          date: string;
          side: 'buy' | 'sell';
          quantity: string;
          price: string;
        }>;
      }) => ({
        tempId,
        parsedSymbol: security.symbol!,
        parsedName: security.name,
        resolvedSecurity: {
          securityId: security.id,
          providerSymbol: security.providerSymbol,
          symbol: security.symbol!,
          name: security.name!,
          assetClass: security.assetClass,
          providerName: security.providerName,
          currencyCode: security.currencyCode,
          exchangeName: security.exchangeName ?? undefined,
          cryptoCurrencyCode: security.cryptoCurrencyCode ?? undefined,
          alreadyInDb: true,
        },
        resolvedConfidence: 'auto' as const,
        portfolioId: portfolio.id,
        currencyCode: security.currencyCode,
        hasExistingHolding: false,
        transactions: transactions.map((tx) => ({
          ...tx,
          fees: '0',
          amount: (Number(tx.quantity) * Number(tx.price)).toFixed(10),
          possibleDuplicateOf: null,
        })),
      });

      const result = await helpers.investmentImportExecute({
        payload: {
          holdings: [
            buildHolding({
              tempId: 'h-coin02',
              security: coin02,
              transactions: [
                { tempId: 't1', date: '2024-01-01', side: 'buy', quantity: '1.0', price: '100' },
                // Zero-price SELL — burned/lost tokens with no proceeds.
                { tempId: 't2', date: '2024-02-01', side: 'sell', quantity: '0.1', price: '0' },
              ],
            }),
            buildHolding({
              tempId: 'h-coin04',
              security: coin04,
              transactions: [
                { tempId: 't3', date: '2024-01-01', side: 'buy', quantity: '1.0', price: '100' },
                // Zero-price BUY — staking reward, airdrop, or "missing tokens" adjustment.
                { tempId: 't4', date: '2024-02-01', side: 'buy', quantity: '0.5', price: '0' },
              ],
            }),
            buildHolding({
              tempId: 'h-coin05',
              security: coin05,
              transactions: [
                { tempId: 't5', date: '2024-01-01', side: 'buy', quantity: '0.5', price: '50000' },
                // Oversell — qty drops to -0.5; allowed for crypto.
                { tempId: 't6', date: '2024-02-01', side: 'sell', quantity: '1.0', price: '60000' },
                // Buy that does NOT cross back to long — qty stays at -0.3.
                { tempId: 't7', date: '2024-03-01', side: 'buy', quantity: '0.2', price: '100000' },
              ],
            }),
          ],
          skipTempIds: [],
        },
        raw: true,
      });

      expect(result.createdTransactions).toBe(7);
      expect(result.failedTransactions).toBe(0);
      expect(result.warnings).toEqual([]);

      // COIN02 — zero-price SELL just reduces qty; basis scales by remaining qty.
      const [h02] = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: { securityId: coin02.id },
        raw: true,
      });
      expect(h02!.quantity).toBeNumericEqual(0.9);
      expect(h02!.costBasis).toBeNumericEqual(90); // 100 * (0.9 / 1.0)

      // COIN04 — zero-price BUY grows position at zero cost; basis stays put.
      const [h04] = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: { securityId: coin04.id },
        raw: true,
      });
      expect(h04!.quantity).toBeNumericEqual(1.5);
      expect(h04!.costBasis).toBeNumericEqual(100);

      // COIN05 — net-short position: basis must be zero (no long to attribute cost to).
      const [h05] = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: { securityId: coin05.id },
        raw: true,
      });
      expect(h05!.quantity).toBeNumericEqual(-0.3);
      expect(h05!.costBasis).toBeNumericEqual(0);
    });
  });

  describe('extract source=csv', () => {
    /**
     * Build a column mapping with sensible defaults for the BTC/ETH crypto CSVs
     * the tests use. Individual tests override only the fields they care about.
     */
    function buildMapping(overrides: Partial<InvestmentColumnMapping> = {}): InvestmentColumnMapping {
      return {
        symbol: 'Symbol',
        date: 'Date',
        side: 'Action',
        quantity: 'Quantity',
        price: 'Price',
        fees: 'Fees',
        currency: 'Currency',
        name: null,
        defaultCurrency: 'USD',
        defaultAssetClassHint: 'crypto',
        sideValueMapping: {
          Buy: INVESTMENT_TRANSACTION_CATEGORY.buy,
          Sell: INVESTMENT_TRANSACTION_CATEGORY.sell,
          Dividend: INVESTMENT_TRANSACTION_CATEGORY.dividend,
        },
        ...overrides,
      };
    }

    it('groups rows into holdings, resolves the security, parses locale numbers and keeps dividends', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'CSV Crypto' }),
        raw: true,
      });

      const btc = await createCryptoSecurity({ symbol: 'BTC', name: 'Bitcoin', providerSymbol: 'bitcoin' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: btc.id } });

      const csv = [
        'Symbol,Date,Action,Quantity,Price,Fees,Currency',
        // US locale, US$ symbol on price — also covers currency-symbol stripping.
        'BTC,2024-01-15,Buy,0.05,"$42,000.00",5.25,USDT',
        // European locale.
        'BTC,2024-02-20,Sell,0.02,"50.000,00",2.10,USDT',
        // Dividend row — quantity (units received), price (per-unit value), fees 0.
        'BTC,2024-02-01,Dividend,0.001,42500,0,USDT',
      ].join('\n');

      const result = await helpers.investmentImportExtract({
        payload: {
          source: 'csv',
          fileBase64: encodeFile({ text: csv }),
          defaultPortfolioId: portfolio.id,
          columnMapping: buildMapping(),
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      const holding = result.holdings[0]!;
      expect(holding.parsedSymbol).toBe('BTC');
      expect(holding.resolvedSecurity?.securityId).toBe(btc.id);
      expect(holding.resolvedConfidence).toBe('auto');
      expect(holding.currencyCode).toBe('USD'); // USDT → USD
      expect(holding.transactions).toHaveLength(3);
      expect(holding.transactions.map((t) => t.side)).toEqual(['buy', 'sell', 'dividend']);
      expect(holding.transactions[0]!.price).toBe('42000');
      expect(holding.transactions[1]!.price).toBe('50000');
      // amount = quantity * price + fees for buys, - fees for sells
      expect(holding.transactions[0]!.amount).toBe('2105.2500000000');
      expect(holding.transactions[1]!.amount).toBe('997.9000000000');
      expect(result.fileType).toBe('csv');
      expect(result.tokenCount).toEqual({ input: 0, output: 0 });
    });

    it('rejects when a mapped column does not exist in the CSV headers', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'CSV bad mapping' }),
        raw: true,
      });

      const csv = ['Symbol,Date,Action,Quantity,Price', 'BTC,2024-01-15,Buy,0.05,42000'].join('\n');

      const result = await helpers.investmentImportExtract({
        payload: {
          source: 'csv',
          fileBase64: encodeFile({ text: csv }),
          defaultPortfolioId: portfolio.id,
          columnMapping: buildMapping({ symbol: 'TickerThatDoesntExist' }),
        },
      });

      expect(result.statusCode).not.toBe(200);
    });

    it('surfaces unparseable rows as a warning instead of failing the extract', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'CSV invalid rows' }),
        raw: true,
      });

      const btc = await createCryptoSecurity({ symbol: 'BTC', name: 'Bitcoin', providerSymbol: 'bitcoin' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: btc.id } });

      const csv = [
        'Symbol,Date,Action,Quantity,Price,Fees,Currency',
        // valid
        'BTC,2024-01-15,Buy,0.05,42000,5.25,USDT',
        // invalid: side "Swap" not in mapping
        'BTC,2024-01-16,Swap,0.01,42000,0,USDT',
        // invalid: unparseable date
        'BTC,not-a-date,Buy,0.01,42000,0,USDT',
        // invalid: missing symbol
        ',2024-01-17,Buy,0.01,42000,0,USDT',
      ].join('\n');

      const result = await helpers.investmentImportExtract({
        payload: {
          source: 'csv',
          fileBase64: encodeFile({ text: csv }),
          defaultPortfolioId: portfolio.id,
          columnMapping: buildMapping(),
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0]!.transactions).toHaveLength(1);

      expect(result.warnings).toEqual(
        expect.arrayContaining([
          { code: 'CSV_ROWS_INVALID', params: { count: 3, total: 4 } },
          { code: 'CSV_ROW_UNMAPPED_SIDE', params: { row: 2, value: 'Swap' } },
          { code: 'CSV_ROW_INVALID_DATE', params: { row: 3, value: 'not-a-date' } },
          { code: 'CSV_ROW_MISSING_SYMBOL', params: { row: 4 } },
        ]),
      );
    });

    it('silently drops rows whose side value is mapped to the skip sentinel', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'CSV with skip' }),
        raw: true,
      });

      const btc = await createCryptoSecurity({ symbol: 'BTC', name: 'Bitcoin', providerSymbol: 'bitcoin' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: btc.id } });

      const csv = [
        'Symbol,Date,Action,Quantity,Price,Fees,Currency',
        'BTC,2024-01-15,Buy,0.05,42000,0,USDT',
        // Cash-movement rows — user marked these as skip; they should not appear
        // in holdings AND should not pollute the invalid-rows warning list.
        'CASH,2024-01-20,Deposit,500,1,0,USD',
        'CASH,2024-01-21,Withdrawal,200,1,0,USD',
        'BTC,2024-02-20,Sell,0.02,50000,0,USDT',
      ].join('\n');

      const result = await helpers.investmentImportExtract({
        payload: {
          source: 'csv',
          fileBase64: encodeFile({ text: csv }),
          defaultPortfolioId: portfolio.id,
          columnMapping: buildMapping({
            sideValueMapping: {
              Buy: INVESTMENT_TRANSACTION_CATEGORY.buy,
              Sell: INVESTMENT_TRANSACTION_CATEGORY.sell,
              Deposit: INVESTMENT_IMPORT_SIDE_SKIP,
              Withdrawal: INVESTMENT_IMPORT_SIDE_SKIP,
            },
          }),
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0]!.transactions.map((t) => t.side)).toEqual(['buy', 'sell']);
      // Critical: no "N of M CSV rows were skipped" warning — skip is deliberate.
      expect(result.warnings.find((w) => w.code === 'CSV_ROWS_INVALID')).toBeUndefined();
      expect(result.warnings).toContainEqual({ code: 'CSV_ROWS_SKIPPED', params: { count: 2 } });
    });

    it('splits compound tickers like SOL-USD into ticker + quote currency', async () => {
      // Yahoo Finance + most crypto-aware exports use TICKER-CURRENCY for the
      // symbol column. Resolver only knows bare tickers — without the split
      // we'd try to look up `SOL-USD` on CoinGecko and miss every row.
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'CSV compound tickers' }),
        raw: true,
      });

      const sol = await createCryptoSecurity({ symbol: 'SOL', name: 'Solana', providerSymbol: 'solana' });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: sol.id } });

      const csv = [
        // No currency column on purpose so the ticker suffix has to do the work.
        'Symbol,Date,Action,Quantity,Price',
        'SOL-USD,2024-01-15,Buy,1.5,85.12',
        'SOL-USD,2024-02-20,Sell,0.5,90.00',
      ].join('\n');

      const result = await helpers.investmentImportExtract({
        payload: {
          source: 'csv',
          fileBase64: encodeFile({ text: csv }),
          defaultPortfolioId: portfolio.id,
          columnMapping: buildMapping({
            // Currency + Fees columns intentionally unmapped — relies on the
            // ticker suffix for currency and on the parser's "fees default to 0".
            fees: null,
            currency: null,
            defaultCurrency: null,
          }),
        },
        raw: true,
      });

      expect(result.holdings).toHaveLength(1);
      // Symbol is the SOL head, not the compound SOL-USD.
      expect(result.holdings[0]!.parsedSymbol).toBe('SOL');
      expect(result.holdings[0]!.resolvedSecurity?.securityId).toBe(sol.id);
      // Currency was inferred from the ticker suffix.
      expect(result.holdings[0]!.currencyCode).toBe('USD');
      expect(result.holdings[0]!.transactions).toHaveLength(2);
    });
  });

  /**
   * The default `express.json()` limit is 100KB. Both endpoints receive the whole
   * uploaded file as base64 (files up to 10MB are accepted), so the request body
   * must be allowed to grow well past that ceiling.
   */
  describe('request body size limit', () => {
    const MIN_BODY_BYTES = 100 * 1024;
    const ROW_COUNT = 300;

    // Broker exports carry a free-text description column the user never maps.
    // Padding it grows the file without inflating the parsed row count.
    const DESCRIPTION_LENGTH = 300;
    const DESCRIPTION_PADDING = 'TRADE CONFIRMATION SETTLED VIA CLEARING HOUSE '.repeat(8);

    const CSV_HEADERS = 'Symbol,Date,Action,Quantity,Price,Description';

    const SYMBOL = 'AAPL';

    function buildOversizedCsv({ rowCount }: { rowCount: number }): string {
      const rows = Array.from({ length: rowCount }, (_, index) => {
        const day = String((index % 28) + 1).padStart(2, '0');
        const side = index % 3 === 0 ? 'SELL' : 'BUY';
        const description = `Order ${index} ${DESCRIPTION_PADDING}`.slice(0, DESCRIPTION_LENGTH);
        return `${SYMBOL},2024-03-${day},${side},${(index % 20) + 1},${180 + (index % 50)}.25,${description}`;
      });

      return [CSV_HEADERS, ...rows].join('\n');
    }

    const COLUMN_MAPPING: InvestmentColumnMapping = {
      symbol: 'Symbol',
      date: 'Date',
      side: 'Action',
      quantity: 'Quantity',
      price: 'Price',
      fees: null,
      currency: null,
      name: null,
      defaultCurrency: null,
      defaultAssetClassHint: 'stocks',
      sideValueMapping: {
        BUY: INVESTMENT_TRANSACTION_CATEGORY.buy,
        SELL: INVESTMENT_TRANSACTION_CATEGORY.sell,
      },
    };

    it('POST /investments/transactions-import/estimate-cost accepts an oversized base64 file', async () => {
      const payload = { fileBase64: encodeFile({ text: buildOversizedCsv({ rowCount: ROW_COUNT }) }) };
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(MIN_BODY_BYTES);

      const response = await helpers.investmentImportEstimateCost({ payload });

      // A file the model can't fit still answers 200 with `success: false` in
      // the body, so the status alone is what proves the body was parsed.
      expect(response.statusCode).toBe(200);
    });

    it('POST /investments/transactions-import/extract accepts an oversized base64 file', async () => {
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Body limit' }),
        raw: true,
      });

      // Seeding the security + holding keeps symbol resolution on the
      // user-securities branch, so no provider lookup happens.
      const [aapl] = await helpers.seedSecurities([{ symbol: SYMBOL, name: 'Apple Inc.' }]);
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: aapl!.id } });

      const payload = {
        source: 'csv' as const,
        fileBase64: encodeFile({ text: buildOversizedCsv({ rowCount: ROW_COUNT }) }),
        defaultPortfolioId: portfolio.id,
        columnMapping: COLUMN_MAPPING,
      };
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(MIN_BODY_BYTES);

      const response = await helpers.investmentImportExtract({ payload });

      expect(response.statusCode).toBe(200);

      const { holdings } = response.body.response;
      expect(holdings).toHaveLength(1);
      expect(holdings[0]!.parsedSymbol).toBe(SYMBOL);
      expect(holdings[0]!.transactions).toHaveLength(ROW_COUNT);
    });
  });
});
