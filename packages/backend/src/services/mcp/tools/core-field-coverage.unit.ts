import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { adjustAccountBalance } from '@services/accounts/balance-adjustment';
import { createCategory } from '@services/categories/create-category';
import { editCategory } from '@services/categories/edit-category';
import { createTag } from '@services/tags/create-tag';
import { updateTag } from '@services/tags/update-tag';
import { createTransaction } from '@services/transactions/create-transaction';
import { updateTransaction } from '@services/transactions/update-transaction';
import { captureTools, makeExtra } from '@tests/helpers/mcp-tools';

// Block the real services, whose import chains build queues at module scope and would open Redis
// connections in a unit test.
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/categories/create-category', () => ({ createCategory: jest.fn() }));
jest.mock('@services/categories/edit-category', () => ({ editCategory: jest.fn() }));
jest.mock('@services/accounts/balance-adjustment', () => ({ adjustAccountBalance: jest.fn() }));
jest.mock('@services/tags/create-tag', () => ({ createTag: jest.fn() }));
jest.mock('@services/tags/update-tag', () => ({ updateTag: jest.fn() }));
jest.mock('@root/serializers/transactions.serializer', () => ({
  ...jest.requireActual<object>('@root/serializers/transactions.serializer'),
  serializeTransactionTuple: jest.fn(() => []),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { adjustAccountBalanceTool } from './adjust-account-balance';
import { createCategoryTool } from './create-category';
import { createTagTool } from './create-tag';
import { createTransactionTool } from './create-transaction';
import { updateCategoryTool } from './update-category';
import { updateTagTool } from './update-tag';
import { updateTransactionTool } from './update-transaction';

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
const addTag = jest.mocked(createTag);
const editTag = jest.mocked(updateTag);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isBaseCurrencyChangeLocked).mockResolvedValue(false);
});

describe('create_transaction', () => {
  const tool = captureTools({ register: createTransactionTool })[0]!;
  const schema = tool.config.inputSchema!;
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

  it('rejects the time, split and tag values the REST body rejects', () => {
    expect(schema.safeParse({ ...base, time: '2026-10-01T10:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ ...base, time: 'yesterday' }).success).toBe(false);
    expect(schema.safeParse({ ...base, time: '1999-12-31T00:00:00.000Z' }).success).toBe(false);
    const split = { categoryId: CATEGORY_ID, amount: 1 };
    expect(schema.safeParse({ ...base, splits: Array.from({ length: 11 }, () => split) }).success).toBe(false);
    expect(schema.safeParse({ ...base, tagIds: Array.from({ length: 21 }, () => TAG_ID) }).success).toBe(false);
  });

  it('refuses the cross-field combinations the REST body refuses, with the service not called', async () => {
    const transfer = { ...base, transferNature: 'transfer_between_user_accounts', categoryId: undefined };
    for (const args of [
      { ...base, categoryId: undefined },
      transfer,
      { ...transfer, destinationAccountId: ID, destinationAmount: 5, splits: [{ categoryId: CATEGORY_ID, amount: 5 }] },
      { ...base, originalAmount: 66.42 },
      { ...transfer, destinationAccountId: ID, destinationAmount: 5, originalAmount: 1, originalCurrencyCode: 'PLN' },
    ]) {
      await expect(tool.handler(args, WRITE)).rejects.toThrow();
    }
    expect(create).not.toHaveBeenCalled();
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
        excludeFromStats: true,
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
        excludeFromStats: true,
      }),
    );
  });
});

describe('update_transaction', () => {
  const tool = captureTools({ register: updateTransactionTool })[0]!;
  const schema = tool.config.inputSchema!;

  it('accepts the detail fields, null to clear them, and rejects invalid values', () => {
    expect(
      schema.safeParse({
        id: ID,
        externalUrl: 'https://example.com/a',
        externalReference: 'R-1',
        location: LOCATION,
        payeeLocked: false,
        isPlanned: true,
        excludeFromStats: true,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ id: ID, externalUrl: null, externalReference: null, location: null }).success).toBe(true);
    expect(schema.safeParse({ id: ID, externalUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(schema.safeParse({ id: ID, location: { latitude: 0, longitude: 181 } }).success).toBe(false);
    expect(schema.safeParse({ id: ID, isPlanned: 'no' }).success).toBe(false);
  });

  it('rejects a time the REST body rejects', () => {
    expect(schema.safeParse({ id: ID, time: '2026-10-01T10:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ id: ID, time: '2026-10-01' }).success).toBe(false);
  });

  it('refuses the cross-field combinations the REST body refuses, with the service not called', async () => {
    const split = { categoryId: CATEGORY_ID, amount: 5 };
    for (const args of [
      { id: ID, splits: [split], transferNature: 'transfer_out_wallet' },
      { id: ID, splits: [split], destinationAccountId: ACCOUNT_ID },
      { id: ID, transferNature: 'transfer_between_user_accounts', destinationAccountId: ACCOUNT_ID },
      { id: ID, originalAmount: 66.42 },
      { id: ID, originalAmount: null, originalCurrencyCode: 'PLN' },
      { id: ID, originalAmount: 1, originalCurrencyCode: 'PLN', destinationAmount: 5 },
    ]) {
      await expect(tool.handler(args, WRITE)).rejects.toThrow();
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('passes the detail fields to the service, nulls included', async () => {
    update.mockResolvedValue([] as never);
    await tool.handler(
      {
        id: ID,
        externalUrl: null,
        externalReference: 'R-1',
        location: LOCATION,
        payeeLocked: true,
        isPlanned: false,
        excludeFromStats: true,
      },
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
        excludeFromStats: true,
      }),
    );
  });
});

describe('create_category', () => {
  const tool = captureTools({ register: createCategoryTool })[0]!;
  const schema = tool.config.inputSchema!;

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

  it('rejects the name, color and icon values the REST body rejects', () => {
    expect(schema.safeParse({ name: '' }).success).toBe(false);
    expect(schema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ name: 'Food', color: 'red' }).success).toBe(false);
    expect(schema.safeParse({ name: 'Food', icon: 'x'.repeat(51) }).success).toBe(false);
  });

  it('refuses a top-level category without a color, with the service not called', async () => {
    await expect(tool.handler({ name: 'Food' }, WRITE)).rejects.toThrow();
    expect(addCategory).not.toHaveBeenCalled();

    addCategory.mockResolvedValue({} as never);
    await tool.handler({ name: 'Food', parentId: ID }, WRITE);
    expect(addCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Food', parentId: ID }));
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
  const tool = captureTools({ register: updateCategoryTool })[0]!;
  const schema = tool.config.inputSchema!;

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

  it('rejects the name and color values the REST body rejects', () => {
    expect(schema.safeParse({ categoryId: CATEGORY_ID, name: '' }).success).toBe(false);
    expect(schema.safeParse({ categoryId: CATEGORY_ID, color: '#12345' }).success).toBe(false);
  });

  it('refuses an update with no field to change, with the service not called', async () => {
    await expect(tool.handler({ categoryId: CATEGORY_ID }, WRITE)).rejects.toThrow();
    expect(editCat).not.toHaveBeenCalled();
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

describe('create_tag', () => {
  const tool = captureTools({ register: createTagTool })[0]!;
  const schema = tool.config.inputSchema!;

  it('rejects the values the REST body rejects', () => {
    expect(schema.safeParse({ name: 'Trip', color: '#FF5733' }).success).toBe(true);
    expect(schema.safeParse({ name: '', color: '#FF5733' }).success).toBe(false);
    expect(schema.safeParse({ name: 'x'.repeat(101), color: '#FF5733' }).success).toBe(false);
    expect(schema.safeParse({ name: 'Trip', color: 'red' }).success).toBe(false);
    expect(schema.safeParse({ name: 'Trip', color: '#FF5733', icon: 'x'.repeat(51) }).success).toBe(false);
    expect(schema.safeParse({ name: 'Trip', color: '#FF5733', description: 'x'.repeat(501) }).success).toBe(false);
  });

  it('trims the name and lowercases the color like the REST body', () => {
    expect(schema.parse({ name: ' Trip ', color: '#FF5733' })).toEqual({ name: 'Trip', color: '#ff5733' });
  });

  it('passes the parsed fields to the service', async () => {
    addTag.mockResolvedValue({} as never);
    await tool.handler({ name: 'Trip', color: '#ff5733', icon: null }, WRITE);
    expect(addTag).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, name: 'Trip', color: '#ff5733' }));
  });
});

describe('update_tag', () => {
  const tool = captureTools({ register: updateTagTool })[0]!;
  const schema = tool.config.inputSchema!;

  it('rejects the values the REST body rejects', () => {
    expect(schema.safeParse({ id: ID, icon: null, description: null }).success).toBe(true);
    expect(schema.safeParse({ id: ID, name: '' }).success).toBe(false);
    expect(schema.safeParse({ id: ID, color: '#GGGGGG' }).success).toBe(false);
    expect(schema.safeParse({ id: ID, description: 'x'.repeat(501) }).success).toBe(false);
  });

  it('passes the fields to the service', async () => {
    editTag.mockResolvedValue({} as never);
    await tool.handler({ id: ID, name: 'Trip', description: null }, WRITE);
    expect(editTag).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, id: ID, name: 'Trip', description: null }),
    );
  });
});

describe('adjust_account_balance', () => {
  const tool = captureTools({ register: adjustAccountBalanceTool })[0]!;
  const schema = tool.config.inputSchema!;

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
