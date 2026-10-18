import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import {
  createHoldingBodySchema,
  deleteHoldingBodySchema,
  SecuritySearchResultSchema,
} from '@controllers/investments/holdings/schemas';
import { securityPricesQuerySchema } from '@controllers/investments/prices/schemas';
import { appendLinksBodySchema, replaceLinksBodySchema } from '@controllers/venture/events/schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { createHoldingFromInput } from '@services/investments/holdings/create-holding-from-input.service';
import { deleteHolding } from '@services/investments/holdings/delete-holding.service';
import { getPrices } from '@services/investments/securities-price/get-prices.service';
import {
  findStoredSecurityBySymbol,
  findStoredSecurityIds,
} from '@services/investments/securities/find-stored.service';
import { searchSecurities } from '@services/investments/securities/search.service';
import { linkTxsToEvent } from '@services/venture/linking/link-txs-to-event.service';
import { replaceEventLinks } from '@services/venture/linking/replace-event-links.service';
import { unlinkTxFromEvent } from '@services/venture/linking/unlink-tx-from-event.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. No test here can reach a price provider.
jest.mock('@services/investments/holdings/create-holding-from-input.service', () => ({
  createHoldingFromInput: jest.fn(),
}));
jest.mock('@services/investments/holdings/delete-holding.service', () => ({ deleteHolding: jest.fn() }));
jest.mock('@services/investments/securities/find-stored.service', () => ({
  findStoredSecurityBySymbol: jest.fn(),
  findStoredSecurityIds: jest.fn(),
}));
jest.mock('@services/investments/securities/search.service', () => ({ searchSecurities: jest.fn() }));
jest.mock('@services/investments/securities-price/get-prices.service', () => ({ getPrices: jest.fn() }));
jest.mock('@services/venture/linking/link-txs-to-event.service', () => ({ linkTxsToEvent: jest.fn() }));
jest.mock('@services/venture/linking/replace-event-links.service', () => ({ replaceEventLinks: jest.fn() }));
jest.mock('@services/venture/linking/unlink-tx-from-event.service', () => ({ unlinkTxFromEvent: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerCreateHolding } from './create-holding';
import { registerDeleteHolding } from './delete-holding';
import { registerDeleteVentureEventLink } from './delete-venture-event-link';
import { registerGetSecurityPrices } from './get-security-prices';
import { registerLinkTransactionsToVentureEvent } from './link-transactions-to-venture-event';
import { registerReplaceVentureEventLinks } from './replace-venture-event-links';
import { registerSearchSecurities } from './search-securities';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const READ_ONLY_USER_WITH_SCOPES = makeExtra({ readOnly: true });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const search = jest.mocked(searchSecurities);
const findBySymbol = jest.mocked(findStoredSecurityBySymbol);
const findStoredIds = jest.mocked(findStoredSecurityIds);
const createFromInput = jest.mocked(createHoldingFromInput);
const removeHolding = jest.mocked(deleteHolding);
const prices = jest.mocked(getPrices);
const link = jest.mocked(linkTxsToEvent);
const replaceLinks = jest.mocked(replaceEventLinks);
const unlink = jest.mocked(unlinkTxFromEvent);

const PORTFOLIO_ID = '11111111-1111-4111-8111-111111111111';
const SECURITY_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const LINK_ID = '44444444-4444-4444-8444-444444444444';
const TX_ID = '55555555-5555-4555-8555-555555555555';
const TX_ID_2 = '66666666-6666-4666-8666-666666666666';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

/** What a provider returns for a search, including the routing keys `create_holding` needs. */
const makeSearchResult = (patch: Record<string, unknown> = {}) => ({
  symbol: 'VOO',
  providerSymbol: 'VOO',
  name: 'Vanguard S&P 500 ETF',
  assetClass: ASSET_CLASS.stocks,
  providerName: SECURITY_PROVIDER.fmp,
  exchangeAcronym: 'NYSE',
  exchangeMic: 'ARCX',
  exchangeName: 'NYSE Arca',
  currencyCode: 'USD',
  ...patch,
});

const makeHolding = (patch: Record<string, unknown> = {}) => ({
  portfolioId: PORTFOLIO_ID,
  securityId: SECURITY_ID,
  currencyCode: 'USD',
  quantity: Money.fromDecimal(0),
  costBasis: Money.fromDecimal(0),
  refCostBasis: Money.fromDecimal(0),
  value: Money.fromDecimal(0),
  refValue: Money.fromDecimal(0),
  createdAt: new Date('2026-10-05T10:00:00.000Z'),
  updatedAt: new Date('2026-10-05T10:00:00.000Z'),
  ...patch,
});

const makeLink = (patch: Record<string, unknown> = {}) => ({
  id: LINK_ID,
  ventureEventId: EVENT_ID,
  transactionId: TX_ID,
  amount: Money.fromDecimal(250.5),
  currencyCode: 'USD',
  linkedAt: new Date('2026-10-06T10:00:00.000Z'),
  metaData: { originalTransactionState: { transferNature: 'not_transfer' } },
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
  findStoredIds.mockResolvedValue([]);
});

describe('search_securities', () => {
  const tool = captureTools({ register: registerSearchSecurities })[0]!;

  it('keeps its input and tells the agent how a result reaches create_holding', () => {
    expect(tool.name).toBe('search_securities');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['limit', 'portfolioId', 'query']);
    expect(tool.config.description).toMatch(/create_holding/);
    expect(tool.config.description).toMatch(/searchResult/);
    expect(tool.config.description).toMatch(/securityId/);
    expect(tool.config.description).toMatch(/get_portfolio_holdings/);
    expect(tool.config.description).toMatch(/get_security_prices/);
  });

  it('searches for the caller and works for a read-only user during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    search.mockResolvedValue([]);

    const data = await call({ tool, args: { query: 'VOO', portfolioId: PORTFOLIO_ID, limit: 5 }, extra: READ_ONLY });

    expect(search).toHaveBeenCalledWith({ query: 'VOO', limit: 5, portfolioId: PORTFOLIO_ID, user: { id: 42 } });
    expect(data).toEqual([]);
  });

  it('returns the routing keys a holding needs, and the fields it had before', async () => {
    search.mockResolvedValue([
      makeSearchResult({ priceSourceSymbol: 'VUSA.L', isInPortfolio: true, marketCapRank: 3 }),
    ] as never);

    const [item] = (await call({ tool, args: { query: 'VOO' } })) as Record<string, unknown>[];

    expect(item).toEqual({
      symbol: 'VOO',
      providerSymbol: 'VOO',
      priceSourceSymbol: 'VUSA.L',
      name: 'Vanguard S&P 500 ETF',
      assetClass: ASSET_CLASS.stocks,
      providerName: SECURITY_PROVIDER.fmp,
      exchangeAcronym: 'NYSE',
      exchangeMic: 'ARCX',
      exchangeName: 'NYSE Arca',
      currencyCode: 'USD',
      marketCapRank: 3,
      isInPortfolio: true,
    });
  });

  it('omits a key the provider left null or unset, so the result still validates against the REST schema', async () => {
    search.mockResolvedValue([
      makeSearchResult({
        priceSourceSymbol: null,
        cusip: null,
        isin: undefined,
        cryptoCurrencyCode: null,
        logoUrl: null,
        matchType: 'exact',
      }),
    ] as never);

    const [item] = (await call({ tool, args: { query: 'VOO' } })) as Record<string, unknown>[];

    expect(item).not.toHaveProperty('priceSourceSymbol');
    expect(item).not.toHaveProperty('cusip');
    expect(item).not.toHaveProperty('isin');
    expect(item).not.toHaveProperty('cryptoCurrencyCode');
    expect(item).not.toHaveProperty('logoUrl');
    expect(item).toHaveProperty('matchType', 'exact');
    expect(SecuritySearchResultSchema.safeParse(item).success).toBe(true);
  });

  it('returns results that validate against the schema create_holding accepts, whatever the provider sets', async () => {
    const results = [
      makeSearchResult(),
      makeSearchResult({
        symbol: 'IWDA',
        providerSymbol: 'IE00B4L5Y983',
        priceSourceSymbol: 'IWDA.AS',
        cusip: '922908363',
        isin: 'IE00B4L5Y983',
        logoUrl: 'https://example.com/logo.png',
        matchType: 'partial',
        currencyCode: 'EUR',
      }),
    ];
    search.mockResolvedValue(results.map((r) => ({ ...r, isInPortfolio: false })) as never);

    const items = (await call({ tool, args: { query: 'VOO' } })) as unknown[];

    expect(items).toHaveLength(2);
    items.forEach((item, index) => {
      const parsed = SecuritySearchResultSchema.safeParse(item);
      expect(parsed.success).toBe(true);
      // Nothing a provider set is lost on the way: the parsed result equals the search result.
      expect(parsed.data).toEqual(results[index]);
    });
  });

  it('adds the securityId to a result that matches a security already stored, and only to that one', async () => {
    const stored = makeSearchResult();
    const unknown = makeSearchResult({ symbol: 'QQQ', providerSymbol: 'QQQ' });
    search.mockResolvedValue([stored, unknown] as never);
    findStoredIds.mockResolvedValue([SECURITY_ID, null]);

    const items = (await call({ tool, args: { query: 'VOO' } })) as Record<string, unknown>[];

    expect(findStoredIds).toHaveBeenCalledWith({ results: [stored, unknown] });
    expect(items[0]).toHaveProperty('securityId', SECURITY_ID);
    expect(items[1]).not.toHaveProperty('securityId');
  });

  it('feeds a result straight into create_holding, which hands the full search result to the service', async () => {
    const result = makeSearchResult({ priceSourceSymbol: 'VUSA.L' });
    search.mockResolvedValue([{ ...result, isInPortfolio: false }] as never);
    createFromInput.mockResolvedValue(makeHolding() as never);

    const [item] = (await call({ tool, args: { query: 'VOO' } })) as unknown[];
    const createTool = captureTools({ register: registerCreateHolding })[0]!;
    await call({ tool: createTool, args: { portfolioId: PORTFOLIO_ID, searchResult: item }, extra: WRITE });

    expect(createFromInput).toHaveBeenCalledWith({ userId: 42, portfolioId: PORTFOLIO_ID, searchResult: result });
  });
});

describe('create_holding', () => {
  const tool = captureTools({ register: registerCreateHolding })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const searchResult = makeSearchResult();

  it('registers under its name and says where the securityId comes from', () => {
    expect(tool.name).toBe('create_holding');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual([
      'portfolioId',
      'searchResult',
      'securityId',
    ]);
    expect(tool.config.description).toMatch(/search_securities/);
    expect(tool.config.description).toMatch(/securityId/);
    expect(tool.config.description).toMatch(/create_investment_transaction/);
  });

  it('validates the search result with the schema the REST route uses', () => {
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID, searchResult }).success).toBe(true);
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID }).success).toBe(true);
    expect(
      schema.safeParse({ portfolioId: PORTFOLIO_ID, searchResult: { ...searchResult, providerName: 'nope' } }).success,
    ).toBe(false);
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID, searchResult: { symbol: 'VOO' } }).success).toBe(false);
    expect(schema.safeParse({ portfolioId: 'nope', securityId: SECURITY_ID }).success).toBe(false);
  });

  it('accepts and rejects the same bodies as the REST body schema, the one-of rule included', async () => {
    createFromInput.mockResolvedValue(makeHolding() as never);
    const bodies = [
      { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID },
      { portfolioId: PORTFOLIO_ID, searchResult },
      { portfolioId: PORTFOLIO_ID },
      { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID, searchResult },
      { portfolioId: PORTFOLIO_ID, searchResult: { symbol: 'VOO' } },
      { securityId: SECURITY_ID },
      { portfolioId: 'nope', securityId: SECURITY_ID },
    ];

    for (const body of bodies) {
      const accepted = await tool.handler(body, WRITE).then(
        () => true,
        () => false,
      );
      expect({ body, accepted }).toEqual({ body, accepted: createHoldingBodySchema.safeParse(body).success });
    }
  });

  it('refuses a body with both ids, or neither, before the service', async () => {
    await expect(
      call({ tool, args: { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID, searchResult }, extra: WRITE }),
    ).rejects.toThrow();
    await expect(call({ tool, args: { portfolioId: PORTFOLIO_ID }, extra: WRITE })).rejects.toThrow();
    expect(createFromInput).not.toHaveBeenCalled();
  });

  it('creates the holding from a securityId for the caller and returns it slimmed', async () => {
    createFromInput.mockResolvedValue(makeHolding() as never);

    const data = await call({ tool, args: { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID }, extra: WRITE });

    expect(createFromInput).toHaveBeenCalledWith({ userId: 42, portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID });
    expect(data).toEqual({
      portfolioId: PORTFOLIO_ID,
      securityId: SECURITY_ID,
      currencyCode: 'USD',
      quantity: 0,
      costBasis: 0,
      refCostBasis: 0,
    });
  });

  it('creates the holding from a search result, dropping a key the schema does not know', async () => {
    createFromInput.mockResolvedValue(makeHolding() as never);

    await call({
      tool,
      args: { portfolioId: PORTFOLIO_ID, searchResult: { ...searchResult, isInPortfolio: false } },
      extra: WRITE,
    });

    expect(createFromInput).toHaveBeenCalledWith({ userId: 42, portfolioId: PORTFOLIO_ID, searchResult });
  });

  it('passes the service errors on: an unsupported asset class, a duplicate, a portfolio that is not the callers', async () => {
    const args = { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID };

    createFromInput.mockRejectedValueOnce(
      new ValidationError({ message: 'Asset class "crypto" is not supported yet.' }),
    );
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/not supported yet/);

    createFromInput.mockRejectedValueOnce(new NotFoundError({ message: 'Portfolio not found' }));
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow('Portfolio not found');
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(createFromInput).not.toHaveBeenCalled();
  });
});

describe('delete_holding', () => {
  const tool = captureTools({ register: registerDeleteHolding })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the fields of the REST body, and warns about force', () => {
    expect(tool.name).toBe('delete_holding');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      Object.keys(deleteHoldingBodySchema.shape).toSorted(),
    );
    expect(tool.config.description).toMatch(/force/);
    expect(tool.config.description).toMatch(/irreversible|permanent/i);
  });

  it('requires both ids and a boolean force', () => {
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID }).success).toBe(true);
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID, force: true }).success).toBe(true);
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID, force: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID }).success).toBe(false);
    expect(schema.safeParse({ securityId: SECURITY_ID }).success).toBe(false);
  });

  it('deletes for the caller without force by default', async () => {
    removeHolding.mockResolvedValue(undefined as never);

    const data = await call({ tool, args: { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID }, extra: DELETE_ONLY });

    expect(removeHolding).toHaveBeenCalledWith({
      userId: 42,
      portfolioId: PORTFOLIO_ID,
      securityId: SECURITY_ID,
      force: undefined,
    });
    expect(data).toEqual({ deleted: true, portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID });
  });

  it('passes force through', async () => {
    removeHolding.mockResolvedValue(undefined as never);

    await call({ tool, args: { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID, force: true }, extra: DELETE_ONLY });

    expect(removeHolding).toHaveBeenCalledWith({
      userId: 42,
      portfolioId: PORTFOLIO_ID,
      securityId: SECURITY_ID,
      force: true,
    });
  });

  it('refuses a read-only user, a write-only scope and a base-currency change, before the service', async () => {
    const args = { portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID };

    await expect(call({ tool, args, extra: makeExtra({ readOnly: true }) })).rejects.toThrow();
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(removeHolding).not.toHaveBeenCalled();
  });
});

describe('get_security_prices', () => {
  const tool = captureTools({ register: registerGetSecurityPrices })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const row = (patch: Record<string, unknown> = {}) => ({
    id: LINK_ID,
    securityId: SECURITY_ID,
    date: new Date('2026-10-02T00:00:00.000Z'),
    priceClose: Money.fromDecimal(512.34),
    priceAsOf: null,
    source: 'fmp',
    createdAt: new Date('2026-10-03T00:00:00.000Z'),
    updatedAt: new Date('2026-10-03T00:00:00.000Z'),
    ...patch,
  });

  it('registers under its name with the REST query fields plus a limit and the symbol lookup', () => {
    expect(tool.name).toBe('get_security_prices');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      [...Object.keys(securityPricesQuerySchema.shape), 'limit', 'providerName', 'symbol'].toSorted(),
    );
    expect(schema.safeParse({ securityId: SECURITY_ID }).success).toBe(true);
    expect(schema.safeParse({ symbol: 'VOO', providerName: SECURITY_PROVIDER.fmp }).success).toBe(true);
    expect(schema.safeParse({ securityId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ symbol: 'VOO', providerName: 'nope' }).success).toBe(false);
  });

  it('refuses a call that names no security, both ways to name it, or half of the symbol lookup', async () => {
    for (const args of [
      {},
      { securityId: SECURITY_ID, symbol: 'VOO', providerName: SECURITY_PROVIDER.fmp },
      { symbol: 'VOO' },
      { providerName: SECURITY_PROVIDER.fmp },
    ]) {
      await expect(call({ tool, args })).rejects.toThrow(/securityId|symbol/);
    }
    expect(prices).not.toHaveBeenCalled();
  });

  it('looks a stored security up by symbol and provider, then reads its prices with the same window', async () => {
    findBySymbol.mockResolvedValue({ id: SECURITY_ID } as never);
    prices.mockResolvedValue([row()] as never);

    const data = await call({
      tool,
      args: { symbol: 'VOO', providerName: SECURITY_PROVIDER.fmp, to: '2026-10-05T00:00:00.000Z' },
    });

    expect(findBySymbol).toHaveBeenCalledWith({ symbol: 'VOO', providerName: SECURITY_PROVIDER.fmp });
    expect(prices).toHaveBeenCalledWith({
      securityId: SECURITY_ID,
      from: new Date('2025-10-05T00:00:00.000Z'),
      to: new Date('2026-10-05T00:00:00.000Z'),
    });
    expect(data).toMatchObject({ total: 1 });
  });

  it('reports not found when no stored security matches the symbol, without reading prices', async () => {
    findBySymbol.mockResolvedValue(null);

    await expect(call({ tool, args: { symbol: 'NOPE', providerName: SECURITY_PROVIDER.fmp } })).rejects.toThrow(
      /not found/i,
    );
    expect(prices).not.toHaveBeenCalled();
  });

  it('points at the symbol lookup in its description', () => {
    expect(tool.config.description).toMatch(/symbol/);
    expect(tool.config.description).toMatch(/search_securities/);
  });

  it('takes the REST datetime bounds', () => {
    expect(
      schema.safeParse({ securityId: SECURITY_ID, from: '2026-10-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' })
        .success,
    ).toBe(true);
    expect(schema.safeParse({ securityId: SECURITY_ID, from: 'yesterday' }).success).toBe(false);
  });

  it('reads the prices for the security with the bounds as dates, slimmed, for a read-only user during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    prices.mockResolvedValue([row(), row({ date: new Date('2026-10-03T00:00:00.000Z'), source: null })] as never);

    const data = await call({
      tool,
      args: { securityId: SECURITY_ID, from: '2026-10-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' },
      extra: READ_ONLY,
    });

    expect(prices).toHaveBeenCalledWith({
      securityId: SECURITY_ID,
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-05T00:00:00.000Z'),
    });
    expect(data).toEqual({
      prices: [
        { date: '2026-10-02T00:00:00.000Z', priceClose: 512.34, priceAsOf: null, source: 'fmp' },
        { date: '2026-10-03T00:00:00.000Z', priceClose: 512.34, priceAsOf: null, source: null },
      ],
      total: 2,
    });
  });

  it('bounds the read to the year before `to` when `from` is omitted', async () => {
    prices.mockResolvedValue([]);

    expect(await call({ tool, args: { securityId: SECURITY_ID, to: '2026-10-05T00:00:00.000Z' } })).toEqual({
      prices: [],
      total: 0,
    });
    expect(prices).toHaveBeenCalledWith({
      securityId: SECURITY_ID,
      from: new Date('2025-10-05T00:00:00.000Z'),
      to: new Date('2026-10-05T00:00:00.000Z'),
    });
  });

  it('bounds the read to the last year when neither bound is given, leaving the upper end open', async () => {
    prices.mockResolvedValue([]);
    const before = Date.now();

    await call({ tool, args: { securityId: SECURITY_ID } });

    const { from, to } = prices.mock.calls[0]![0];
    const year = 365 * 24 * 60 * 60 * 1000;
    expect(to).toBeUndefined();
    expect(from!.getTime()).toBeGreaterThanOrEqual(before - year);
    expect(from!.getTime()).toBeLessThanOrEqual(Date.now() - year);
  });

  it('keeps an explicit `from` as given, however old', async () => {
    prices.mockResolvedValue([]);

    await call({ tool, args: { securityId: SECURITY_ID, from: '2001-01-01T00:00:00.000Z' } });

    expect(prices).toHaveBeenCalledWith({
      securityId: SECURITY_ID,
      from: new Date('2001-01-01T00:00:00.000Z'),
      to: undefined,
    });
  });

  describe('limit', () => {
    const days = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        row({ date: new Date(Date.UTC(2026, 0, 1 + index)), priceClose: Money.fromDecimal(index + 1) }),
      );

    it('defaults to 500 and caps at 5000 in the input schema', () => {
      expect(schema.safeParse({ securityId: SECURITY_ID, limit: 5000 }).success).toBe(true);
      expect(schema.safeParse({ securityId: SECURITY_ID, limit: 5001 }).success).toBe(false);
      expect(schema.safeParse({ securityId: SECURITY_ID, limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ securityId: SECURITY_ID, limit: 1.5 }).success).toBe(false);
    });

    it('keeps the newest rows, oldest first, and reports the matching total', async () => {
      prices.mockResolvedValue(days(600).toReversed() as never);

      const data = (await call({ tool, args: { securityId: SECURITY_ID } })) as {
        prices: { date: string; priceClose: number }[];
        total: number;
      };

      expect(data.total).toBe(600);
      expect(data.prices).toHaveLength(500);
      expect(data.prices[0]!.priceClose).toBe(101);
      expect(data.prices.at(-1)!.priceClose).toBe(600);
    });

    it('honours a smaller limit', async () => {
      prices.mockResolvedValue(days(10) as never);

      const data = (await call({ tool, args: { securityId: SECURITY_ID, limit: 3 } })) as {
        prices: { priceClose: number }[];
        total: number;
      };

      expect(data.total).toBe(10);
      expect(data.prices.map((price) => price.priceClose)).toEqual([8, 9, 10]);
    });
  });

  it('says in its description that the window and the row count are bounded', () => {
    expect(tool.config.description).toMatch(/365 days|last year/i);
    expect(tool.config.description).toMatch(/limit/);
  });

  it('returns an empty list for a security without any price', async () => {
    prices.mockResolvedValue([]);

    expect(await call({ tool, args: { securityId: SECURITY_ID } })).toEqual({ prices: [], total: 0 });
  });

  it('refuses an inverted range as REST does, before the service', async () => {
    await expect(
      call({
        tool,
        args: { securityId: SECURITY_ID, from: '2026-10-05T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
      }),
    ).rejects.toThrow();
    expect(prices).not.toHaveBeenCalled();
  });
});

describe('link_transactions_to_venture_event', () => {
  const tool = captureTools({ register: registerLinkTransactionsToVentureEvent })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the event id plus the REST body fields, and states the linking rules', () => {
    expect(tool.name).toBe('link_transactions_to_venture_event');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['eventId', ...Object.keys(appendLinksBodySchema.shape)].toSorted(),
    );
    expect(tool.config.description).toMatch(/same currency/i);
    expect(tool.config.description).toMatch(/lpNetAmount/);
    expect(tool.config.description).toMatch(/already linked/i);
  });

  it('requires at least one transaction id', () => {
    expect(schema.safeParse({ eventId: EVENT_ID, transactionIds: [TX_ID] }).success).toBe(true);
    expect(schema.safeParse({ eventId: EVENT_ID, transactionIds: [] }).success).toBe(false);
    expect(schema.safeParse({ eventId: EVENT_ID, transactionIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: [TX_ID] }).success).toBe(false);
  });

  it('links for the caller and returns the links the REST serializer builds, without the stored snapshot', async () => {
    link.mockResolvedValue([makeLink(), makeLink({ id: 'x', transactionId: TX_ID_2 })] as never);

    const data = await call({ tool, args: { eventId: EVENT_ID, transactionIds: [TX_ID, TX_ID_2] }, extra: WRITE });

    expect(link).toHaveBeenCalledWith({ userId: 42, eventId: EVENT_ID, transactionIds: [TX_ID, TX_ID_2] });
    expect(data).toEqual([
      {
        id: LINK_ID,
        ventureEventId: EVENT_ID,
        transactionId: TX_ID,
        amount: '250.5000000000',
        currencyCode: 'USD',
        linkedAt: '2026-10-06T10:00:00.000Z',
      },
      expect.objectContaining({ id: 'x', transactionId: TX_ID_2 }),
    ]);
  });

  it('passes the service errors on', async () => {
    link.mockRejectedValue(new ValidationError({ message: 'Sum of linked transactions does not match' }));

    await expect(call({ tool, args: { eventId: EVENT_ID, transactionIds: [TX_ID] }, extra: WRITE })).rejects.toThrow(
      /does not match/,
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { eventId: EVENT_ID, transactionIds: [TX_ID] };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(link).not.toHaveBeenCalled();
  });
});

describe('replace_venture_event_links', () => {
  const tool = captureTools({ register: registerReplaceVentureEventLinks })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the event id plus the REST body fields', () => {
    expect(tool.name).toBe('replace_venture_event_links');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['eventId', ...Object.keys(replaceLinksBodySchema.shape)].toSorted(),
    );
    expect(tool.config.description).toMatch(/empty/i);
  });

  it('accepts an empty list, which unlinks everything', () => {
    expect(schema.safeParse({ eventId: EVENT_ID, transactionIds: [] }).success).toBe(true);
    expect(schema.safeParse({ eventId: EVENT_ID, transactionIds: [TX_ID] }).success).toBe(true);
    expect(schema.safeParse({ eventId: EVENT_ID }).success).toBe(false);
  });

  it('replaces the links for the caller and returns the new ones', async () => {
    replaceLinks.mockResolvedValue([makeLink()] as never);

    const data = await call({ tool, args: { eventId: EVENT_ID, transactionIds: [TX_ID] }, extra: WRITE });

    expect(replaceLinks).toHaveBeenCalledWith({ userId: 42, eventId: EVENT_ID, transactionIds: [TX_ID] });
    expect(data).toEqual([expect.objectContaining({ id: LINK_ID, amount: '250.5000000000' })]);
  });

  it('returns an empty list when the new set is empty', async () => {
    replaceLinks.mockResolvedValue([]);

    expect(await call({ tool, args: { eventId: EVENT_ID, transactionIds: [] }, extra: WRITE })).toEqual([]);
    expect(replaceLinks).toHaveBeenCalledWith({ userId: 42, eventId: EVENT_ID, transactionIds: [] });
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { eventId: EVENT_ID, transactionIds: [] };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(replaceLinks).not.toHaveBeenCalled();
  });
});

describe('delete_venture_event_link', () => {
  const tool = captureTools({ register: registerDeleteVentureEventLink })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and says the transaction is restored', () => {
    expect(tool.name).toBe('delete_venture_event_link');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['eventId', 'linkId']);
    expect(tool.config.description).toMatch(/restore/i);
    expect(schema.safeParse({ eventId: EVENT_ID, linkId: LINK_ID }).success).toBe(true);
    expect(schema.safeParse({ eventId: EVENT_ID }).success).toBe(false);
    expect(schema.safeParse({ eventId: EVENT_ID, linkId: 'nope' }).success).toBe(false);
  });

  it('unlinks for the caller, naming the event so a link of another event is refused by the service', async () => {
    unlink.mockResolvedValue({ success: true });

    const data = await call({ tool, args: { eventId: EVENT_ID, linkId: LINK_ID }, extra: DELETE_ONLY });

    expect(unlink).toHaveBeenCalledWith({ userId: 42, eventId: EVENT_ID, linkId: LINK_ID });
    expect(data).toEqual({ deleted: true, eventId: EVENT_ID, linkId: LINK_ID });
  });

  it("passes another user's link through as the service not-found error", async () => {
    unlink.mockRejectedValue(new NotFoundError({ message: 'Venture event link not found' }));

    await expect(call({ tool, args: { eventId: EVENT_ID, linkId: LINK_ID }, extra: DELETE_ONLY })).rejects.toThrow(
      'Venture event link not found',
    );
  });

  it('refuses a read-only user, a write-only scope and a base-currency change, before the service', async () => {
    const args = { eventId: EVENT_ID, linkId: LINK_ID };

    await expect(call({ tool, args, extra: makeExtra({ readOnly: true }) })).rejects.toThrow();
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(unlink).not.toHaveBeenCalled();
  });
});
