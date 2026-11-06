import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExchangeRateUnavailableError } from '@js/errors';
import { getExchangeRatesForDate } from '@services/exchange-rates';
import { getAllSystemCurrencies } from '@services/system-currencies';
import * as userExchangeRateService from '@services/user-exchange-rate';
import * as userService from '@services/user.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';

// Block the real services, whose import chains build queues and Redis clients at module scope.
jest.mock('@services/user.service', () => ({
  getUserCurrencies: jest.fn(),
  getUserBaseCurrency: jest.fn(),
  editUserCurrency: jest.fn(),
  deleteUserCurrency: jest.fn(),
}));
jest.mock('@services/currencies/add-user-currency', () => ({ addUserCurrencies: jest.fn() }));
jest.mock('@services/user-exchange-rate', () => ({ getExchangeRate: jest.fn(), getUserExchangeRates: jest.fn() }));
jest.mock('@services/exchange-rates', () => ({ getExchangeRatesForDate: jest.fn() }));
jest.mock('@services/system-currencies', () => ({ getAllSystemCurrencies: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { addUserCurrencies } from '@services/currencies/add-user-currency';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { addUserCurrenciesTool } from './add-user-currencies';
import { deleteUserCurrencyTool } from './delete-user-currency';
import { getExchangeRateTool } from './get-exchange-rate';
import { getUserCurrenciesTool } from './get-user-currencies';
import { listSupportedCurrenciesTool } from './list-supported-currencies';
import { updateUserCurrencyTool } from './update-user-currency';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const READ_ONLY_WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'], readOnly: true });
const DEMO_WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'], role: 'demo' });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const users = jest.mocked(userService);
const rates = jest.mocked(userExchangeRateService);
const ratesForDate = jest.mocked(getExchangeRatesForDate);
const addCurrencies = jest.mocked(addUserCurrencies);
const systemCurrencies = jest.mocked(getAllSystemCurrencies);

const LOCKED = /currencies.baseCurrencyChangeInProgress/;

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_user_currencies', () => {
  const tool = captureTools({ register: getUserCurrenciesTool })[0]!;

  it('returns the currencies, the base currency and the pair rates in one result, with no scope helper', async () => {
    const eur = { currencyCode: 'EUR', isDefaultCurrency: true, currency: { code: 'EUR', digits: 2 } };
    const usd = { currencyCode: 'USD', isDefaultCurrency: false, currency: { code: 'USD', digits: 2 } };
    users.getUserCurrencies.mockResolvedValueOnce([eur, usd] as never);
    users.getUserBaseCurrency.mockResolvedValueOnce(eur as never);
    rates.getUserExchangeRates.mockResolvedValueOnce([
      { baseCode: 'USD', quoteCode: 'EUR', rate: 0.92, date: new Date('2026-10-18T00:00:00Z') },
    ] as never);

    const result = await tool.handler(makeExtra({ scopes: ['finance:read'], readOnly: true }));
    const data = parseToolResult({ result }) as Record<string, unknown>;

    expect(users.getUserCurrencies).toHaveBeenCalledWith({ userId: 42 });
    expect(users.getUserBaseCurrency).toHaveBeenCalledWith({ userId: 42 });
    expect(rates.getUserExchangeRates).toHaveBeenCalledWith({ userId: 42 });
    expect(data).toEqual({
      baseCurrency: eur,
      currencies: [eur, usd],
      exchangeRates: [{ baseCode: 'USD', quoteCode: 'EUR', rate: 0.92, date: '2026-10-18T00:00:00.000Z' }],
    });
  });

  it('returns a null base currency for a user who has none', async () => {
    users.getUserCurrencies.mockResolvedValueOnce([]);
    users.getUserBaseCurrency.mockResolvedValueOnce(null as never);
    rates.getUserExchangeRates.mockResolvedValueOnce([]);

    const result = await tool.handler(WRITE);

    expect(parseToolResult({ result })).toEqual({ baseCurrency: null, currencies: [], exchangeRates: [] });
  });
});

describe('list_supported_currencies', () => {
  const tool = captureTools({ register: listSupportedCurrenciesTool })[0]!;

  it('lists code, name and decimals of every ISO currency the app supports', async () => {
    systemCurrencies.mockResolvedValueOnce([
      { code: 'USD', currency: 'US Dollar', digits: 2, number: 840, isCustom: false, symbol: null, isDisabled: false },
      { code: 'JPY', currency: 'Yen', digits: 0, number: 392, isCustom: false, symbol: null, isDisabled: false },
    ] as never);

    const result = await tool.handler(makeExtra({ scopes: ['finance:read'], readOnly: true }));

    expect(parseToolResult({ result })).toEqual([
      { code: 'USD', name: 'US Dollar', decimals: 2 },
      { code: 'JPY', name: 'Yen', decimals: 0 },
    ]);
  });
});

describe('get_exchange_rate', () => {
  const tool = captureTools({ register: getExchangeRateTool })[0]!;
  const schema = tool.config.inputSchema!;
  const readOnly = makeExtra({ scopes: ['finance:read'], readOnly: true });

  it('accepts a date alone or with both codes, and rejects a malformed or impossible date', () => {
    expect(schema.safeParse({ date: '2026-10-18' }).success).toBe(true);
    expect(schema.safeParse({ date: '2026-10-18', from: 'USD', to: 'EUR' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ date: '18-10-2026' }).success).toBe(false);
    expect(schema.safeParse({ date: '2026-02-31' }).success).toBe(false);
  });

  it('reads one pair without a user connection', async () => {
    rates.getExchangeRate.mockResolvedValueOnce({
      baseCode: 'USD',
      quoteCode: 'EUR',
      rate: 0.92,
      date: new Date('2026-10-18T00:00:00Z'),
    });

    const result = await tool.handler({ date: '2026-10-18', from: 'USD', to: 'EUR' }, readOnly);

    expect(rates.getExchangeRate).toHaveBeenCalledWith({
      userId: 42,
      baseCode: 'USD',
      quoteCode: 'EUR',
      date: new Date('2026-10-18'),
      requireUserConnection: false,
    });
    expect(parseToolResult({ result })).toEqual({
      baseCode: 'USD',
      quoteCode: 'EUR',
      rate: 0.92,
      date: '2026-10-18T00:00:00.000Z',
    });
    expect(ratesForDate).not.toHaveBeenCalled();
  });

  it('turns a missing rate into a clear "no rate" error', async () => {
    rates.getExchangeRate.mockRejectedValueOnce(new ExchangeRateUnavailableError({ message: 'No rate for USD/XYZ' }));

    await expect(tool.handler({ date: '2026-10-18', from: 'USD', to: 'EUR' }, readOnly)).rejects.toThrow(
      /No exchange rate.*USD.*EUR.*2026-10-18/,
    );
  });

  it('rejects a code that is not a currency code', () => {
    expect(schema.safeParse({ date: '2026-10-18', from: 'USD', to: 'EU' }).success).toBe(false);
    expect(schema.safeParse({ date: '2026-10-18', from: 'USD', to: 'EURO' }).success).toBe(false);
  });

  it('returns the global rates of the date when no code is given', async () => {
    ratesForDate.mockResolvedValueOnce([
      { baseCode: 'USD', quoteCode: 'EUR', rate: 0.92, date: new Date('2026-10-18'), id: 1 },
    ] as never);

    const result = await tool.handler({ date: '2026-10-18' }, readOnly);

    expect(ratesForDate).toHaveBeenCalledWith({ date: '2026-10-18' });
    expect(parseToolResult({ result })).toEqual({
      date: '2026-10-18',
      rates: [{ baseCode: 'USD', quoteCode: 'EUR', rate: 0.92 }],
    });
  });

  it('returns an empty list when the date has no stored rates', async () => {
    ratesForDate.mockResolvedValueOnce(null);

    const result = await tool.handler({ date: '2026-10-18' }, readOnly);

    expect(parseToolResult({ result })).toEqual({ date: '2026-10-18', rates: [] });
  });

  it.each([{ from: 'USD' }, { to: 'EUR' }])('refuses one code alone (%j) without reading anything', async (codes) => {
    await expect(tool.handler({ date: '2026-10-18', ...codes }, readOnly)).rejects.toThrow(/both "from" and "to"/);

    expect(rates.getExchangeRate).not.toHaveBeenCalled();
    expect(ratesForDate).not.toHaveBeenCalled();
  });
});

describe('add_user_currencies', () => {
  const tool = captureTools({ register: addUserCurrenciesTool })[0]!;
  const schema = tool.config.inputSchema!;
  const args = {
    currencies: [{ currencyCode: 'EUR', exchangeRate: 2, liveRateUpdate: true }, { currencyCode: 'USD' }],
  };

  it('accepts currencies with optional rate fields, and rejects an empty list, a bad rate and unknown keys', () => {
    expect(schema.safeParse(args).success).toBe(true);
    expect(schema.safeParse({ currencies: [] }).success).toBe(false);
    expect(schema.safeParse({ currencies: [{ currencyCode: 'EUR', exchangeRate: 0 }] }).success).toBe(false);
    expect(schema.safeParse({ currencies: [{ currencyCode: 'EUR', extra: 1 }] }).success).toBe(false);
  });

  it('adds the currencies for the user and returns the service result', async () => {
    addCurrencies.mockResolvedValueOnce({ currencies: [], alreadyExistingCodes: ['USD'] } as never);

    const result = await tool.handler(args, WRITE);

    expect(addCurrencies).toHaveBeenCalledWith([
      { userId: 42, currencyCode: 'EUR', exchangeRate: 2, liveRateUpdate: true },
      { userId: 42, currencyCode: 'USD' },
    ]);
    expect(parseToolResult({ result })).toEqual({ currencies: [], alreadyExistingCodes: ['USD'] });
  });
});

describe('update_user_currency', () => {
  const tool = captureTools({ register: updateUserCurrencyTool })[0]!;
  const schema = tool.config.inputSchema!;

  it('requires a code and accepts the optional rate fields', () => {
    expect(schema.safeParse({ currencyCode: 'EUR', exchangeRate: 1.5, liveRateUpdate: false }).success).toBe(true);
    expect(schema.safeParse({ exchangeRate: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ currencyCode: 'EUR', liveRateUpdate: 'yes' }).success).toBe(false);
  });

  it('passes the mapped arguments on and returns the updated currency', async () => {
    users.editUserCurrency.mockResolvedValueOnce({ currencyCode: 'EUR', liveRateUpdate: false } as never);

    const result = await tool.handler({ currencyCode: 'EUR', liveRateUpdate: false }, WRITE);

    expect(users.editUserCurrency).toHaveBeenCalledWith({
      userId: 42,
      currencyCode: 'EUR',
      exchangeRate: undefined,
      liveRateUpdate: false,
    });
    expect(parseToolResult({ result })).toEqual({ currencyCode: 'EUR', liveRateUpdate: false });
  });
});

describe('delete_user_currency', () => {
  const tool = captureTools({ register: deleteUserCurrencyTool })[0]!;

  it('requires a code', () => {
    const schema = tool.config.inputSchema!;
    expect(schema.safeParse({ currencyCode: 'EUR' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('removes the currency and confirms it', async () => {
    users.deleteUserCurrency.mockResolvedValueOnce(undefined as never);

    const result = await tool.handler({ currencyCode: 'EUR' }, DELETE);

    expect(users.deleteUserCurrency).toHaveBeenCalledWith({ userId: 42, currencyCode: 'EUR' });
    expect(parseToolResult({ result })).toEqual({ deleted: true, currencyCode: 'EUR' });
  });

  it('needs finance:delete, not finance:write', async () => {
    await expect(tool.handler({ currencyCode: 'EUR' }, WRITE)).rejects.toThrow(
      /Missing required scope: finance:delete/,
    );
    expect(users.deleteUserCurrency).not.toHaveBeenCalled();
  });
});

describe('write guards', () => {
  const cases = [
    {
      name: 'add_user_currencies',
      register: addUserCurrenciesTool,
      args: { currencies: [{ currencyCode: 'EUR' }] },
      mocked: () => addCurrencies,
    },
    {
      name: 'update_user_currency',
      register: updateUserCurrencyTool,
      args: { currencyCode: 'EUR', liveRateUpdate: true },
      mocked: () => users.editUserCurrency,
    },
  ];

  it.each(cases)('$name is refused without the write scope, for read-only and for demo users', async (c) => {
    const tool = captureTools({ register: c.register })[0]!;
    expect(tool.name).toBe(c.name);

    await expect(tool.handler(c.args, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(c.args, READ_ONLY_WRITE)).rejects.toThrow(/no longer includes editing/);
    await expect(tool.handler(c.args, DEMO_WRITE)).rejects.toThrow(/demo mode/);
    expect(c.mocked()).not.toHaveBeenCalled();
  });

  it.each([
    ...cases,
    {
      name: 'delete_user_currency',
      register: deleteUserCurrencyTool,
      args: { currencyCode: 'EUR' },
      mocked: () => users.deleteUserCurrency,
    },
  ])('$name is refused while the base-currency lock is set', async (c) => {
    lockCheck.mockResolvedValueOnce(true);
    const tool = captureTools({ register: c.register })[0]!;

    await expect(tool.handler(c.args, makeExtra())).rejects.toThrow(LOCKED);
    expect(c.mocked()).not.toHaveBeenCalled();
  });

  it('delete_user_currency is refused for read-only and demo users', async () => {
    const tool = captureTools({ register: deleteUserCurrencyTool })[0]!;

    await expect(tool.handler({ currencyCode: 'EUR' }, makeExtra({ readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler({ currencyCode: 'EUR' }, makeExtra({ role: 'demo' }))).rejects.toThrow(/demo mode/);
    expect(users.deleteUserCurrency).not.toHaveBeenCalled();
  });
});
