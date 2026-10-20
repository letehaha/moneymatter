import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { adjustAccountBalance } from '@services/accounts/balance-adjustment';
import { createCategory } from '@services/categories/create-category';
import { editCategory } from '@services/categories/edit-category';
import { createTransaction } from '@services/transactions/create-transaction';
import { updateTransaction } from '@services/transactions/update-transaction';
import { captureTools, makeExtra } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open Redis
// connections in a unit test.
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/categories/create-category', () => ({ createCategory: jest.fn() }));
jest.mock('@services/categories/edit-category', () => ({ editCategory: jest.fn() }));
jest.mock('@services/accounts/balance-adjustment', () => ({ adjustAccountBalance: jest.fn() }));
jest.mock('@root/serializers/transactions.serializer', () => ({
  ...jest.requireActual<object>('@root/serializers/transactions.serializer'),
  serializeTransactionTuple: jest.fn(() => []),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerAdjustAccountBalance } from './adjust-account-balance';
import { registerCreateCategory } from './create-category';
import { registerCreateTransaction } from './create-transaction';
import { registerUpdateCategory } from './update-category';
import { registerUpdateTransaction } from './update-transaction';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });

const ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const TAG_ID = '44444444-4444-4444-8444-444444444444';
const LOCATION = { latitude: 52.5, longitude: 13.4 };

const create = jest.mocked(createTransaction);
const update = jest.mocked(updateTransaction);
const addCategory = jest.mocked(createCategory);
const editCat = jest.mocked(editCategory);
const adjust = jest.mocked(adjustAccountBalance);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isBaseCurrencyChangeLocked).mockResolvedValue(false);
});

describe('create_transaction', () => {
  const tool = captureTools({ register: registerCreateTransaction })[0]!;
  const schema = z.object(tool.config.inputSchema!);
  const base = {
    accountId: ACCOUNT_ID,
    amount: 10,
    transactionType: 'expense',
    paymentType: 'cash',
    transferNature: 'not_transfer',
    categoryId: CATEGORY_ID,
  };

  it('accepts the detail fields and rejects invalid values', () => {
    expect(
      schema.safeParse({
        ...base,
        externalUrl: 'https://example.com/invoice/1',
        externalReference: 'INV-1',
        location: LOCATION,
        payeeLocked: true,
        applyAutomations: true,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...base, externalUrl: 'ftp://example.com' }).success).toBe(false);
    expect(schema.safeParse({ ...base, externalReference: 'x'.repeat(256) }).success).toBe(false);
    expect(schema.safeParse({ ...base, location: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(schema.safeParse({ ...base, payeeLocked: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ ...base, applyAutomations: 'yes' }).success).toBe(false);
  });

  it('passes the detail fields to the service', async () => {
    create.mockResolvedValue([] as never);
    await tool.handler(
      {
        ...base,
        externalUrl: 'https://example.com/invoice/1',
        externalReference: 'INV-1',
        location: LOCATION,
        payeeLocked: true,
        applyAutomations: true,
      },
      WRITE,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUrl: 'https://example.com/invoice/1',
        externalReference: 'INV-1',
        location: LOCATION,
        payeeLocked: true,
        applyAutomations: true,
      }),
    );
  });
});

describe('update_transaction', () => {
  const tool = captureTools({ register: registerUpdateTransaction })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts the detail fields, null to clear them, and rejects invalid values', () => {
    expect(
      schema.safeParse({
        id: ID,
        externalUrl: 'https://example.com/a',
        externalReference: 'R-1',
        location: LOCATION,
        payeeLocked: false,
        isPlanned: true,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ id: ID, externalUrl: null, externalReference: null, location: null }).success).toBe(true);
    expect(schema.safeParse({ id: ID, externalUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(schema.safeParse({ id: ID, location: { latitude: 0, longitude: 181 } }).success).toBe(false);
    expect(schema.safeParse({ id: ID, isPlanned: 'no' }).success).toBe(false);
  });

  it('passes the detail fields to the service, nulls included', async () => {
    update.mockResolvedValue([] as never);
    await tool.handler(
      { id: ID, externalUrl: null, externalReference: 'R-1', location: LOCATION, payeeLocked: true, isPlanned: false },
      WRITE,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ID,
        externalUrl: null,
        externalReference: 'R-1',
        location: LOCATION,
        payeeLocked: true,
        isPlanned: false,
      }),
    );
  });
});

describe('create_category', () => {
  const tool = captureTools({ register: registerCreateCategory })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts the default tag fields and rejects invalid values', () => {
    expect(
      schema.safeParse({ name: 'Food', defaultTagIds: [TAG_ID], applyDefaultTagsOnAiCategorization: true }).success,
    ).toBe(true);
    expect(schema.safeParse({ name: 'Food', defaultTagIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ name: 'Food', defaultTagIds: Array.from({ length: 21 }, () => TAG_ID) }).success).toBe(
      false,
    );
    expect(schema.safeParse({ name: 'Food', applyDefaultTagsOnAiCategorization: 'x' }).success).toBe(false);
  });

  it('passes the default tag fields to the service', async () => {
    addCategory.mockResolvedValue({} as never);
    await tool.handler(
      { name: 'Food', color: '#FF0000', defaultTagIds: [TAG_ID], applyDefaultTagsOnAiCategorization: true },
      WRITE,
    );
    expect(addCategory).toHaveBeenCalledWith(
      expect.objectContaining({ defaultTagIds: [TAG_ID], applyDefaultTagsOnAiCategorization: true }),
    );
  });
});

describe('update_category', () => {
  const tool = captureTools({ register: registerUpdateCategory })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts parentId (null included) and the default tag fields, and rejects invalid values', () => {
    expect(
      schema.safeParse({
        categoryId: CATEGORY_ID,
        parentId: ID,
        defaultTagIds: [TAG_ID],
        applyDefaultTagsOnAiCategorization: false,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ categoryId: CATEGORY_ID, parentId: null, defaultTagIds: [] }).success).toBe(true);
    expect(schema.safeParse({ categoryId: CATEGORY_ID, parentId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ categoryId: CATEGORY_ID, defaultTagIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ categoryId: CATEGORY_ID, applyDefaultTagsOnAiCategorization: 1 }).success).toBe(false);
  });

  it('passes the new fields to the service', async () => {
    editCat.mockResolvedValue([] as never);
    await tool.handler(
      { categoryId: CATEGORY_ID, parentId: null, defaultTagIds: [TAG_ID], applyDefaultTagsOnAiCategorization: true },
      WRITE,
    );
    expect(editCat).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: CATEGORY_ID,
        parentId: null,
        defaultTagIds: [TAG_ID],
        applyDefaultTagsOnAiCategorization: true,
      }),
    );
  });
});

describe('adjust_account_balance', () => {
  const tool = captureTools({ register: registerAdjustAccountBalance })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts an ISO time and rejects other values', () => {
    expect(schema.safeParse({ accountId: ACCOUNT_ID, newBalance: 5, time: '2026-10-01T10:00:00.000Z' }).success).toBe(
      true,
    );
    expect(schema.safeParse({ accountId: ACCOUNT_ID, newBalance: 5, time: 'yesterday' }).success).toBe(false);
  });

  it('passes the time to the service as a Date', async () => {
    adjust.mockResolvedValue({ previousBalance: 0, newBalance: 5, transaction: null } as never);
    await tool.handler({ accountId: ACCOUNT_ID, newBalance: 5, time: '2026-10-01T10:00:00.000Z' }, WRITE);
    expect(adjust).toHaveBeenCalledWith(expect.objectContaining({ time: new Date('2026-10-01T10:00:00.000Z') }));
  });
});
