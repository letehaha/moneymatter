import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, USER_ROLES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import * as accountsService from '@services/accounts.service';
import { getAccountTransactionCount } from '@services/accounts/transaction-count';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Blocks the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. The account model is mocked so the shared update checks run
// for real against a stubbed row.
jest.mock('@services/accounts.service', () => ({
  getAccountById: jest.fn(),
  createAccount: jest.fn(),
  updateAccount: jest.fn(),
  deleteAccountById: jest.fn(),
  unlinkAccountFromBankConnection: jest.fn(),
}));
jest.mock('@services/accounts/transaction-count', () => ({ getAccountTransactionCount: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreateAccount } from './create-account';
import { registerDeleteAccount } from './delete-account';
import { registerGetAccount } from './get-account';
import { registerUnlinkAccountFromBankConnection } from './unlink-account-from-bank-connection';
import { registerUpdateAccount } from './update-account';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'] });

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const service = jest.mocked(accountsService);
const transactionCount = jest.mocked(getAccountTransactionCount);
const accountModel = jest.mocked(Accounts);

const makeAccountRow = ({
  userId = 42,
  type = ACCOUNT_TYPES.system,
  accountCategory = ACCOUNT_CATEGORIES.general,
}: {
  userId?: number;
  type?: ACCOUNT_TYPES;
  accountCategory?: ACCOUNT_CATEGORIES;
} = {}) => ({
  id: ACCOUNT_ID,
  name: 'Checking',
  initialBalance: Money.fromDecimal(100),
  refInitialBalance: Money.fromDecimal(100),
  currentBalance: Money.fromDecimal(250.5),
  refCurrentBalance: Money.fromDecimal(250.5),
  creditLimit: Money.fromDecimal(0),
  refCreditLimit: Money.fromDecimal(0),
  type,
  accountCategory,
  currencyCode: 'USD',
  userId,
  externalId: null,
  status: 'active',
  excludeFromStats: false,
  bankDataProviderConnectionId: null,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_account', () => {
  const tool = captureTools({ register: registerGetAccount })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts a record id and rejects a missing or malformed one', () => {
    expect(schema.safeParse({ accountId: ACCOUNT_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ accountId: 'not-an-id' }).success).toBe(false);
  });

  it('returns the slimmed account with its transaction count, with no scope helper', async () => {
    service.getAccountById.mockResolvedValueOnce(makeAccountRow() as never);
    transactionCount.mockResolvedValueOnce(7);

    const result = await tool.handler(
      { accountId: ACCOUNT_ID },
      makeExtra({ scopes: ['finance:read'], readOnly: true }),
    );

    expect(service.getAccountById).toHaveBeenCalledWith({ userId: 42, id: ACCOUNT_ID });
    expect(transactionCount).toHaveBeenCalledWith({ userId: 42, accountId: ACCOUNT_ID });
    expect(parseToolResult({ result })).toMatchObject({
      id: ACCOUNT_ID,
      name: 'Checking',
      type: ACCOUNT_TYPES.system,
      accountCategory: ACCOUNT_CATEGORIES.general,
      currencyCode: 'USD',
      currentBalance: 250.5,
      initialBalance: 100,
      creditLimit: 0,
      status: 'active',
      excludeFromStats: false,
      transactionCount: 7,
    });
    expect(parseToolResult({ result })).not.toHaveProperty('userId');
  });

  it('leaves the transaction count out for an account the user only has shared access to', async () => {
    service.getAccountById.mockResolvedValueOnce(makeAccountRow({ userId: 99 }) as never);

    const result = await tool.handler({ accountId: ACCOUNT_ID }, makeExtra());

    expect(transactionCount).not.toHaveBeenCalled();
    expect(parseToolResult({ result })).toMatchObject({ id: ACCOUNT_ID, transactionCount: null });
  });

  it('throws a not-found error for an unknown account', async () => {
    service.getAccountById.mockResolvedValueOnce(null);

    await expect(tool.handler({ accountId: ACCOUNT_ID }, makeExtra())).rejects.toThrow(/accounts.accountNotFound/);
    expect(transactionCount).not.toHaveBeenCalled();
  });
});

describe('create_account', () => {
  const tool = captureTools({ register: registerCreateAccount })[0]!;
  const schema = z.object(tool.config.inputSchema!);
  const input = { name: 'Savings', currencyCode: 'eur' };

  it('accepts a minimal and a full definition, and has no type or status field', () => {
    expect(schema.safeParse(input).success).toBe(true);
    expect(
      schema.safeParse({
        ...input,
        accountCategory: ACCOUNT_CATEGORIES.saving,
        initialBalance: 10.25,
        creditLimit: 500,
        logoDomain: 'example.com',
      }).success,
    ).toBe(true);
    expect(Object.keys(tool.config.inputSchema!)).not.toContain('type');
    expect(Object.keys(tool.config.inputSchema!)).not.toContain('status');
  });

  it.each([
    { label: 'a missing name', input: { name: undefined } },
    { label: 'a blank name', input: { name: '   ' } },
    { label: 'a missing currency code', input: { currencyCode: undefined } },
    { label: 'an invalid currency code', input: { currencyCode: '!' } },
    { label: 'an unknown category', input: { accountCategory: 'piggy' } },
    { label: 'a negative credit limit', input: { creditLimit: -1 } },
  ])('rejects $label', ({ input: patch }) => {
    expect(schema.safeParse({ ...input, ...patch }).success).toBe(false);
  });

  it('rejects a brand domain together with monogram letters, and a color without letters', async () => {
    await expect(tool.handler({ ...input, logoDomain: 'example.com', logoInitials: 'AB' }, WRITE)).rejects.toThrow();
    await expect(tool.handler({ ...input, logoColor: '#ff0000' }, WRITE)).rejects.toThrow();
    expect(service.createAccount).not.toHaveBeenCalled();
  });

  it('creates a system account with Money amounts and returns the slimmed account', async () => {
    service.createAccount.mockResolvedValueOnce(makeAccountRow() as never);

    const result = await tool.handler(
      { ...input, initialBalance: 100, creditLimit: 50.5, logoDomain: 'example.com' },
      WRITE,
    );

    expect(service.createAccount).toHaveBeenCalledTimes(1);
    const payload = service.createAccount.mock.calls[0]![0];
    expect(payload).toMatchObject({
      userId: 42,
      name: 'Savings',
      currencyCode: 'EUR',
      type: ACCOUNT_TYPES.system,
      accountCategory: ACCOUNT_CATEGORIES.general,
      logoDomain: 'example.com',
    });
    expect(payload.initialBalance.toNumber()).toBe(100);
    expect(payload.creditLimit.toNumber()).toBe(50.5);
    expect(parseToolResult({ result })).toMatchObject({ id: ACCOUNT_ID, currentBalance: 250.5 });
  });

  it('defaults the balances to zero', async () => {
    service.createAccount.mockResolvedValueOnce(makeAccountRow() as never);

    await tool.handler(input, WRITE);

    const payload = service.createAccount.mock.calls[0]![0];
    expect(payload.initialBalance.toNumber()).toBe(0);
    expect(payload.creditLimit.toNumber()).toBe(0);
  });

  it('is refused without the write scope, for read-only and for demo users', async () => {
    await expect(tool.handler(input, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(input, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler(input, makeExtra({ scopes: ['finance:write'], role: USER_ROLES.demo }))).rejects.toThrow(
      /demo mode/,
    );
    expect(service.createAccount).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler(input, WRITE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(service.createAccount).not.toHaveBeenCalled();
  });
});

describe('update_account', () => {
  const tool = captureTools({ register: registerUpdateAccount })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  beforeEach(() => {
    accountModel.findOne.mockResolvedValue(makeAccountRow() as never);
    service.updateAccount.mockResolvedValue(makeAccountRow() as never);
  });

  it('accepts a partial update, and has no status field', () => {
    expect(schema.safeParse({ accountId: ACCOUNT_ID, name: 'Renamed' }).success).toBe(true);
    expect(
      schema.safeParse({
        accountId: ACCOUNT_ID,
        accountCategory: ACCOUNT_CATEGORIES.saving,
        creditLimit: 10,
        excludeFromStats: true,
        currentBalance: -5,
        initialBalance: 3,
        logoDomain: null,
        logoInitials: null,
        logoColor: null,
      }).success,
    ).toBe(true);
    expect(Object.keys(tool.config.inputSchema!)).not.toContain('status');
  });

  it.each([
    { label: 'a missing account id', input: { accountId: undefined } },
    { label: 'a blank name', input: { name: '' } },
    { label: 'a negative credit limit', input: { creditLimit: -1 } },
    { label: 'an unknown category', input: { accountCategory: 'piggy' } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse({ accountId: ACCOUNT_ID, name: 'x', ...input }).success).toBe(false);
  });

  it('rejects a brand domain together with monogram letters', async () => {
    await expect(
      tool.handler({ accountId: ACCOUNT_ID, logoDomain: 'example.com', logoInitials: 'AB' }, WRITE),
    ).rejects.toThrow();
    expect(service.updateAccount).not.toHaveBeenCalled();
  });

  it('passes only the given fields, as Money for amounts, and keeps null to clear a logo', async () => {
    const result = await tool.handler(
      {
        accountId: ACCOUNT_ID,
        name: 'Renamed',
        creditLimit: 20,
        excludeFromStats: true,
        currentBalance: 12.5,
        logoDomain: null,
      },
      WRITE,
    );

    expect(service.updateAccount).toHaveBeenCalledTimes(1);
    const payload = service.updateAccount.mock.calls[0]![0] as unknown as {
      creditLimit: Money;
      currentBalance: Money;
    };
    expect(payload).toMatchObject({
      id: ACCOUNT_ID,
      userId: 42,
      name: 'Renamed',
      excludeFromStats: true,
      logoDomain: null,
    });
    expect(payload.creditLimit.toNumber()).toBe(20);
    expect(payload.currentBalance.toNumber()).toBe(12.5);
    expect(Object.keys(payload)).not.toContain('initialBalance');
    expect(Object.keys(payload)).not.toContain('status');
    expect(Object.keys(payload)).not.toContain('accountCategory');
    expect(parseToolResult({ result })).toMatchObject({ id: ACCOUNT_ID });
  });

  it('refuses currentBalance on an account that is not a system account', async () => {
    accountModel.findOne.mockResolvedValue(makeAccountRow({ type: ACCOUNT_TYPES.monobank }) as never);

    await expect(tool.handler({ accountId: ACCOUNT_ID, currentBalance: 10 }, WRITE)).rejects.toThrow(
      /only allowed to be changed for "system" account type/,
    );
    expect(service.updateAccount).not.toHaveBeenCalled();
  });

  it('still lets a non-system account change its name and credit limit', async () => {
    accountModel.findOne.mockResolvedValue(makeAccountRow({ type: ACCOUNT_TYPES.monobank }) as never);

    await tool.handler({ accountId: ACCOUNT_ID, name: 'Card', creditLimit: 100 }, WRITE);

    expect(service.updateAccount).toHaveBeenCalledTimes(1);
  });

  it('refuses a move into the vehicle category', async () => {
    await expect(
      tool.handler({ accountId: ACCOUNT_ID, accountCategory: ACCOUNT_CATEGORIES.vehicle }, WRITE),
    ).rejects.toThrow(/into or out of 'vehicle' is not supported/);
    expect(service.updateAccount).not.toHaveBeenCalled();
  });

  it('refuses a move out of the vehicle category', async () => {
    accountModel.findOne.mockResolvedValue(makeAccountRow({ accountCategory: ACCOUNT_CATEGORIES.vehicle }) as never);

    await expect(
      tool.handler({ accountId: ACCOUNT_ID, accountCategory: ACCOUNT_CATEGORIES.general }, WRITE),
    ).rejects.toThrow(/into or out of 'vehicle' is not supported/);
    expect(service.updateAccount).not.toHaveBeenCalled();
  });

  it('allows a vehicle account to keep its category and a general one to move to another plain category', async () => {
    accountModel.findOne.mockResolvedValue(makeAccountRow({ accountCategory: ACCOUNT_CATEGORIES.vehicle }) as never);
    await tool.handler({ accountId: ACCOUNT_ID, accountCategory: ACCOUNT_CATEGORIES.vehicle, name: 'Car' }, WRITE);

    accountModel.findOne.mockResolvedValue(makeAccountRow() as never);
    await tool.handler({ accountId: ACCOUNT_ID, accountCategory: ACCOUNT_CATEGORIES.saving }, WRITE);

    expect(service.updateAccount).toHaveBeenCalledTimes(2);
  });

  it('throws a not-found error for an account the user does not own', async () => {
    accountModel.findOne.mockResolvedValue(null);

    await expect(tool.handler({ accountId: ACCOUNT_ID, name: 'x' }, WRITE)).rejects.toThrow(/doesn't exist/);
    expect(accountModel.findOne).toHaveBeenCalledWith({ where: { id: ACCOUNT_ID, userId: 42 } });
    expect(service.updateAccount).not.toHaveBeenCalled();
  });

  it('is refused without the write scope, for read-only and for demo users', async () => {
    const args = { accountId: ACCOUNT_ID, name: 'x' };

    await expect(tool.handler(args, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:write'], role: USER_ROLES.demo }))).rejects.toThrow(
      /demo mode/,
    );
    expect(service.updateAccount).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ accountId: ACCOUNT_ID, name: 'x' }, WRITE)).rejects.toThrow(
      /currencies.baseCurrencyChangeInProgress/,
    );
    expect(service.updateAccount).not.toHaveBeenCalled();
  });
});

describe('delete_account', () => {
  const tool = captureTools({ register: registerDeleteAccount })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts an id with an optional flag and rejects a missing or malformed id', () => {
    expect(schema.safeParse({ accountId: ACCOUNT_ID }).success).toBe(true);
    expect(schema.safeParse({ accountId: ACCOUNT_ID, removePortfolioTransfers: true }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ accountId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ accountId: ACCOUNT_ID, removePortfolioTransfers: 'yes' }).success).toBe(false);
  });

  it('calls the service with the user id and the flag', async () => {
    service.deleteAccountById.mockResolvedValueOnce(1 as never);

    const result = await tool.handler({ accountId: ACCOUNT_ID, removePortfolioTransfers: true }, DELETE);

    expect(service.deleteAccountById).toHaveBeenCalledWith({
      id: ACCOUNT_ID,
      userId: 42,
      removePortfolioTransfers: true,
    });
    expect(parseToolResult({ result })).toEqual({ deleted: true, accountId: ACCOUNT_ID });
  });

  it('needs finance:delete, not finance:write, and refuses read-only and demo users', async () => {
    const args = { accountId: ACCOUNT_ID };

    await expect(tool.handler(args, WRITE)).rejects.toThrow(/Missing required scope: finance:delete/);
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:delete'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:delete'], role: USER_ROLES.demo }))).rejects.toThrow(
      /demo mode/,
    );
    expect(service.deleteAccountById).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ accountId: ACCOUNT_ID }, DELETE)).rejects.toThrow(
      /currencies.baseCurrencyChangeInProgress/,
    );
    expect(service.deleteAccountById).not.toHaveBeenCalled();
  });
});

describe('unlink_account_from_bank_connection', () => {
  const tool = captureTools({ register: registerUnlinkAccountFromBankConnection })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts a record id and rejects a missing or malformed one', () => {
    expect(schema.safeParse({ accountId: ACCOUNT_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ accountId: 'nope' }).success).toBe(false);
  });

  it('calls the service with the user id and returns the slimmed manual account', async () => {
    service.unlinkAccountFromBankConnection.mockResolvedValueOnce(makeAccountRow() as never);

    const result = await tool.handler({ accountId: ACCOUNT_ID }, WRITE);

    expect(service.unlinkAccountFromBankConnection).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, userId: 42 });
    expect(parseToolResult({ result })).toMatchObject({
      id: ACCOUNT_ID,
      type: ACCOUNT_TYPES.system,
      bankDataProviderConnectionId: null,
    });
  });

  it('is refused without the write scope, for read-only and for demo users', async () => {
    const args = { accountId: ACCOUNT_ID };

    await expect(tool.handler(args, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:write'], role: USER_ROLES.demo }))).rejects.toThrow(
      /demo mode/,
    );
    expect(service.unlinkAccountFromBankConnection).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ accountId: ACCOUNT_ID }, WRITE)).rejects.toThrow(
      /currencies.baseCurrencyChangeInProgress/,
    );
    expect(service.unlinkAccountFromBankConnection).not.toHaveBeenCalled();
  });
});
