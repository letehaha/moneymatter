import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { templateBodySchema, updateTemplateBodySchema } from '@controllers/transaction-templates/schema';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import { countCategoryTransactions } from '@services/categories/count-category-transactions';
import { getPayeeNames } from '@services/payees/get-payee-names';
import { getTagById } from '@services/tags/get-tag-by-id';
import { getTags } from '@services/tags/get-tags';
import { applyAutomationToHistory } from '@services/transaction-automations/apply-to-history';
import { applyAutomationBodySchema } from '@services/transaction-automations/zod-schemas';
import { getTransactionGroupById, getTransactionGroups } from '@services/transaction-groups';
import {
  createTransactionTemplate,
  deleteTransactionTemplate,
  getTransactionTemplates,
  updateTransactionTemplate,
} from '@services/transaction-templates';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. The serializers pass the already API-shaped fakes through.
jest.mock('@services/transaction-templates', () => ({
  getTransactionTemplates: jest.fn(),
  createTransactionTemplate: jest.fn(),
  updateTransactionTemplate: jest.fn(),
  deleteTransactionTemplate: jest.fn(),
}));
jest.mock('@services/transaction-automations/apply-to-history', () => ({ applyAutomationToHistory: jest.fn() }));
jest.mock('@services/categories/count-category-transactions', () => ({ countCategoryTransactions: jest.fn() }));
jest.mock('@services/tags/get-tags', () => ({ getTags: jest.fn() }));
jest.mock('@services/tags/get-tag-by-id', () => ({ getTagById: jest.fn() }));
jest.mock('@services/transaction-groups', () => ({
  getTransactionGroups: jest.fn(),
  getTransactionGroupById: jest.fn(),
}));
jest.mock('@services/payees/get-payee-names', () => ({ getPayeeNames: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@root/serializers/transactions.serializer', () => ({
  serializeTransactions: (transactions: unknown) => transactions,
  serializeTransaction: (transaction: unknown) => transaction,
}));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerApplyTransactionAutomation } from './apply-transaction-automation';
import { registerCreateTransactionTemplate } from './create-transaction-template';
import { registerDeleteTransactionTemplate } from './delete-transaction-template';
import { registerGetCategoryTransactionCount } from './get-category-transaction-count';
import { registerGetTags } from './get-tags';
import { registerGetTransactionGroups } from './get-transaction-groups';
import { registerGetTransactionTemplates } from './get-transaction-templates';
import { registerUpdateTransactionTemplate } from './update-transaction-template';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const listTemplates = jest.mocked(getTransactionTemplates);
const createTemplate = jest.mocked(createTransactionTemplate);
const updateTemplate = jest.mocked(updateTransactionTemplate);
const deleteTemplate = jest.mocked(deleteTransactionTemplate);
const applyAutomation = jest.mocked(applyAutomationToHistory);
const countCategory = jest.mocked(countCategoryTransactions);
const listTags = jest.mocked(getTags);
const tagById = jest.mocked(getTagById);
const listGroups = jest.mocked(getTransactionGroups);
const groupById = jest.mocked(getTransactionGroupById);
const payeeNames = jest.mocked(getPayeeNames);

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const PAYEE_ID = '44444444-4444-4444-8444-444444444444';
const TAG_ID = '55555555-5555-4555-8555-555555555555';
const AUTOMATION_ID = '66666666-6666-4666-8666-666666666666';
const GROUP_ID = '77777777-7777-4777-8777-777777777777';
const TX_ID = '88888888-8888-4888-8888-888888888888';

const ids = (count: number) =>
  Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const makeTemplate = (patch: Record<string, unknown> = {}) => ({
  id: TEMPLATE_ID,
  userId: 42,
  name: 'Coffee',
  transactionType: TRANSACTION_TYPES.expense,
  amount: 4.5,
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  payeeId: PAYEE_ID,
  paymentType: PAYMENT_TYPES.creditCard,
  note: 'morning',
  originalCurrencyCode: null,
  tagIds: [TAG_ID],
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:00:00.000Z'),
  ...patch,
});

const makeTx = (patch: Record<string, unknown> = {}) => ({
  id: TX_ID,
  time: '2026-10-01T10:00:00.000Z',
  amount: 12.5,
  refAmount: 12.5,
  currencyCode: 'USD',
  note: 'coffee',
  transactionType: TRANSACTION_TYPES.expense,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  accountId: ACCOUNT_ID,
  categoryId: null,
  isPlanned: false,
  payeeId: PAYEE_ID,
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
  payeeNames.mockResolvedValue(new Map());
});

describe('get_transaction_templates', () => {
  const tool = captureTools({ register: registerGetTransactionTemplates })[0]!;

  it('registers under its name and explains that templates are named presets for new transactions', () => {
    expect(tool.name).toBe('get_transaction_templates');
    expect(tool.config.description).toMatch(/preset/i);
    expect(tool.config.description).toMatch(/new transaction/i);
  });

  it('lists the templates of the caller, slimmed, and works for a read-only user while the lock is set', async () => {
    lockCheck.mockResolvedValue(true);
    listTemplates.mockResolvedValue([makeTemplate()] as never);

    const data = await call({ tool, extra: READ_ONLY });

    expect(listTemplates).toHaveBeenCalledWith({ userId: 42 });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual([
      {
        id: TEMPLATE_ID,
        name: 'Coffee',
        transactionType: TRANSACTION_TYPES.expense,
        amount: 4.5,
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        payeeId: PAYEE_ID,
        paymentType: PAYMENT_TYPES.creditCard,
        note: 'morning',
        originalCurrencyCode: null,
        tagIds: [TAG_ID],
      },
    ]);
  });

  it('returns an empty list when there are no templates', async () => {
    listTemplates.mockResolvedValue([]);

    expect(await call({ tool })).toEqual([]);
  });
});

describe('create_transaction_template', () => {
  const tool = captureTools({ register: registerCreateTransactionTemplate })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and declares exactly the fields of the REST body schema', () => {
    expect(tool.name).toBe('create_transaction_template');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      Object.keys(templateBodySchema.shape).toSorted(),
    );
  });

  it('documents the pinned-amount and unique-name rules', () => {
    expect(tool.config.description).toMatch(/accountId/);
    expect(tool.config.description).toMatch(/unique|already/i);
  });

  it('applies the REST validation to every field', () => {
    const base = { name: 'Coffee', transactionType: TRANSACTION_TYPES.expense };

    expect(schema.safeParse(base).success).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        amount: 0,
        accountId: ACCOUNT_ID,
        categoryId: null,
        payeeId: null,
        paymentType: null,
        note: null,
        originalCurrencyCode: 'usd',
        tagIds: [TAG_ID],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ...base, name: 'x'.repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ name: 'Coffee' }).success).toBe(false);
    expect(schema.safeParse({ ...base, transactionType: 'transfer' }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(schema.safeParse({ ...base, accountId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...base, paymentType: 'barter' }).success).toBe(false);
    expect(schema.safeParse({ ...base, note: 'x'.repeat(1001) }).success).toBe(false);
    expect(schema.safeParse({ ...base, originalCurrencyCode: '!' }).success).toBe(false);
    expect(schema.safeParse({ ...base, tagIds: [TAG_ID, TAG_ID] }).success).toBe(false);
    expect(schema.safeParse({ ...base, tagIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ ...base, userId: 7 }).success).toBe(false);
  });

  it('passes the fields to the service for the caller and returns the slim template', async () => {
    createTemplate.mockResolvedValue(makeTemplate() as never);

    const data = await call({
      tool,
      args: {
        name: 'Coffee',
        transactionType: TRANSACTION_TYPES.expense,
        amount: 4.5,
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        tagIds: [TAG_ID],
      },
      extra: WRITE,
    });

    expect(createTemplate).toHaveBeenCalledWith({
      userId: 42,
      name: 'Coffee',
      transactionType: TRANSACTION_TYPES.expense,
      amount: 4.5,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      tagIds: [TAG_ID],
    });
    expect(data).toMatchObject({ id: TEMPLATE_ID, name: 'Coffee', tagIds: [TAG_ID] });
    expect(data).not.toHaveProperty('userId');
    expect(data).not.toHaveProperty('createdAt');
  });

  it('lets the service errors through: a pinned amount without an account and a duplicate name', async () => {
    createTemplate.mockRejectedValueOnce(new ValidationError({ message: 'A pinned amount needs an account.' }));
    await expect(
      call({
        tool,
        args: { name: 'Coffee', transactionType: TRANSACTION_TYPES.expense, amount: 4.5 },
        extra: WRITE,
      }),
    ).rejects.toThrow('A pinned amount needs an account.');

    createTemplate.mockRejectedValueOnce(new ConflictError({ message: 'A template with this name already exists.' }));
    await expect(
      call({ tool, args: { name: 'Coffee', transactionType: TRANSACTION_TYPES.expense }, extra: WRITE }),
    ).rejects.toThrow('A template with this name already exists.');
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { name: 'Coffee', transactionType: TRANSACTION_TYPES.expense };

    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(createTemplate).not.toHaveBeenCalled();
  });
});

describe('update_transaction_template', () => {
  const tool = captureTools({ register: registerUpdateTransactionTemplate })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and declares the id plus every field of the REST update schema', () => {
    expect(tool.name).toBe('update_transaction_template');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['templateId', ...Object.keys(updateTemplateBodySchema.shape)].toSorted(),
    );
  });

  it('documents that null clears a field and tagIds replaces the set', () => {
    expect(tool.config.description).toMatch(/null/);
    expect(tool.config.description).toMatch(/tagIds/);
    expect(tool.config.description).toMatch(/replace/i);
  });

  it('accepts partial fields and null clears, and applies the REST validation', () => {
    expect(schema.safeParse({ templateId: TEMPLATE_ID }).success).toBe(true);
    expect(
      schema.safeParse({
        templateId: TEMPLATE_ID,
        amount: null,
        accountId: null,
        categoryId: null,
        payeeId: null,
        paymentType: null,
        note: null,
        originalCurrencyCode: null,
        tagIds: [],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ name: 'x' }).success).toBe(false);
    expect(schema.safeParse({ templateId: 'nope', name: 'x' }).success).toBe(false);
    expect(schema.safeParse({ templateId: TEMPLATE_ID, name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ templateId: TEMPLATE_ID, amount: -5 }).success).toBe(false);
    expect(schema.safeParse({ templateId: TEMPLATE_ID, tagIds: [TAG_ID, TAG_ID] }).success).toBe(false);
    expect(schema.safeParse({ templateId: TEMPLATE_ID, transactionType: 'transfer' }).success).toBe(false);
  });

  it('passes the id as id and only the given fields to the service', async () => {
    updateTemplate.mockResolvedValue(makeTemplate({ name: 'Latte' }) as never);

    const data = await call({
      tool,
      args: { templateId: TEMPLATE_ID, name: 'Latte', categoryId: null, tagIds: [] },
      extra: WRITE,
    });

    expect(updateTemplate).toHaveBeenCalledTimes(1);
    const params = updateTemplate.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).toEqual({ userId: 42, id: TEMPLATE_ID, name: 'Latte', categoryId: null, tagIds: [] });
    expect(Object.keys(params).toSorted()).toEqual(['categoryId', 'id', 'name', 'tagIds', 'userId']);
    expect(data).toMatchObject({ id: TEMPLATE_ID, name: 'Latte' });
  });

  it('lets a not-found error through', async () => {
    updateTemplate.mockRejectedValue(new NotFoundError({ message: 'Transaction template not found.' }));

    await expect(call({ tool, args: { templateId: TEMPLATE_ID, name: 'x' }, extra: WRITE })).rejects.toThrow(
      'Transaction template not found.',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { templateId: TEMPLATE_ID, name: 'Latte' };

    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(updateTemplate).not.toHaveBeenCalled();
  });
});

describe('delete_transaction_template', () => {
  const tool = captureTools({ register: registerDeleteTransactionTemplate })[0]!;

  it('registers under its name with a template id', () => {
    expect(tool.name).toBe('delete_transaction_template');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['templateId']);
    expect(z.object(tool.config.inputSchema ?? {}).safeParse({ templateId: 'nope' }).success).toBe(false);
  });

  it('deletes the template of the caller and reports it', async () => {
    deleteTemplate.mockResolvedValue({ success: true });

    const data = await call({ tool, args: { templateId: TEMPLATE_ID }, extra: DELETE_ONLY });

    expect(deleteTemplate).toHaveBeenCalledWith({ id: TEMPLATE_ID, userId: 42 });
    expect(data).toEqual({ deleted: true, templateId: TEMPLATE_ID });
  });

  it('requires finance:delete, not finance:write, and refuses a read-only user and a base-currency change', async () => {
    const args = { templateId: TEMPLATE_ID };

    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow();
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(deleteTemplate).not.toHaveBeenCalled();
  });

  it('lets a not-found error through', async () => {
    deleteTemplate.mockRejectedValue(new NotFoundError({ message: 'Transaction template not found.' }));

    await expect(call({ tool, args: { templateId: TEMPLATE_ID }, extra: DELETE_ONLY })).rejects.toThrow(
      'Transaction template not found.',
    );
  });
});

describe('apply_transaction_automation', () => {
  const tool = captureTools({ register: registerApplyTransactionAutomation })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and declares the id plus the transactionIds of the REST body schema', () => {
    expect(tool.name).toBe('apply_transaction_automation');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['automationId', ...Object.keys(applyAutomationBodySchema.shape)].toSorted(),
    );
  });

  it('enforces the REST bounds on transactionIds: 1 to 500, unique, record ids', () => {
    expect(schema.safeParse({ automationId: AUTOMATION_ID, transactionIds: ids(1) }).success).toBe(true);
    expect(schema.safeParse({ automationId: AUTOMATION_ID, transactionIds: ids(500) }).success).toBe(true);
    expect(schema.safeParse({ automationId: AUTOMATION_ID, transactionIds: [] }).success).toBe(false);
    expect(schema.safeParse({ automationId: AUTOMATION_ID, transactionIds: ids(501) }).success).toBe(false);
    expect(schema.safeParse({ automationId: AUTOMATION_ID, transactionIds: [TX_ID, TX_ID] }).success).toBe(false);
    expect(schema.safeParse({ automationId: AUTOMATION_ID, transactionIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: ids(1) }).success).toBe(false);
    expect(schema.safeParse({ automationId: 'nope', transactionIds: ids(1) }).success).toBe(false);
  });

  it('says it changes existing transactions and that unmatched ids are skipped', () => {
    expect(tool.config.description).toMatch(/preview_transaction_automation/);
    expect(tool.config.description).toMatch(/skipped/i);
  });

  it('applies the saved rule to the given transactions and returns the result', async () => {
    const result = { appliedCount: 1, skippedIds: [ids(2)[1]], categorizedAt: '2026-10-18T10:00:00.000Z' };
    applyAutomation.mockResolvedValue(result as never);

    const data = await call({
      tool,
      args: { automationId: AUTOMATION_ID, transactionIds: ids(2) },
      extra: WRITE,
    });

    expect(applyAutomation).toHaveBeenCalledWith({ userId: 42, ruleId: AUTOMATION_ID, transactionIds: ids(2) });
    expect(data).toEqual(result);
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { automationId: AUTOMATION_ID, transactionIds: ids(1) };

    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(applyAutomation).not.toHaveBeenCalled();
  });

  it('lets a not-found error through', async () => {
    applyAutomation.mockRejectedValue(new NotFoundError({ message: 'Automation not found.' }));

    await expect(
      call({ tool, args: { automationId: AUTOMATION_ID, transactionIds: ids(1) }, extra: WRITE }),
    ).rejects.toThrow('Automation not found.');
  });
});

describe('get_category_transaction_count', () => {
  const tool = captureTools({ register: registerGetCategoryTransactionCount })[0]!;

  it('registers under its name, takes a category id and points to delete_category', () => {
    expect(tool.name).toBe('get_category_transaction_count');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['categoryId']);
    expect(z.object(tool.config.inputSchema ?? {}).safeParse({ categoryId: 'nope' }).success).toBe(false);
    expect(tool.config.description).toMatch(/delete_category/);
  });

  it('says a category the caller cannot access is not found, rather than counting 0', () => {
    expect(tool.config.description).toMatch(/not found/i);
    expect(tool.config.description).not.toMatch(/counts 0/);
  });

  it('counts the transactions of the category for the caller, with no scope or lock', async () => {
    lockCheck.mockResolvedValue(true);
    countCategory.mockResolvedValue(7);

    const data = await call({ tool, args: { categoryId: CATEGORY_ID }, extra: READ_ONLY });

    expect(countCategory).toHaveBeenCalledWith({ categoryId: CATEGORY_ID, userId: 42 });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual({ categoryId: CATEGORY_ID, transactionCount: 7 });
  });
});

describe('get_tags', () => {
  const tool = captureTools({ register: registerGetTags })[0]!;

  it('declares an optional tagId', () => {
    const schema = z.object(tool.config.inputSchema ?? {});

    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['tagId']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ tagId: TAG_ID }).success).toBe(true);
    expect(schema.safeParse({ tagId: 'nope' }).success).toBe(false);
  });

  it('lists the tags as before when no tagId is given', async () => {
    listTags.mockResolvedValue([
      { id: TAG_ID, name: 'trip', color: '#FFFFFF', icon: null, description: 'ignored', userId: 42 },
    ] as never);

    const data = await call({ tool, args: {} });

    expect(listTags).toHaveBeenCalledWith({ userId: 42 });
    expect(tagById).not.toHaveBeenCalled();
    expect(data).toEqual([{ id: TAG_ID, name: 'trip', color: '#FFFFFF', icon: null }]);
  });

  it('returns one tag, with its description, when tagId is given', async () => {
    tagById.mockResolvedValue({
      id: TAG_ID,
      userId: 42,
      name: 'trip',
      color: '#FFFFFF',
      icon: 'plane',
      description: 'holiday',
    } as never);

    const data = await call({ tool, args: { tagId: TAG_ID } });

    expect(tagById).toHaveBeenCalledWith({ id: TAG_ID, userId: 42 });
    expect(listTags).not.toHaveBeenCalled();
    expect(data).toEqual({ id: TAG_ID, name: 'trip', color: '#FFFFFF', icon: 'plane', description: 'holiday' });
  });

  it('lets a not-found error through', async () => {
    tagById.mockRejectedValue(new NotFoundError({ message: 'Tag not found.' }));

    await expect(call({ tool, args: { tagId: TAG_ID } })).rejects.toThrow('Tag not found.');
  });
});

describe('get_transaction_groups', () => {
  const tool = captureTools({ register: registerGetTransactionGroups })[0]!;

  it('declares an optional groupId next to includeTransactions', () => {
    const schema = z.object(tool.config.inputSchema ?? {});

    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['groupId', 'includeTransactions']);
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(true);
    expect(schema.safeParse({ groupId: 'nope' }).success).toBe(false);
  });

  it('returns one group with its transactions and their payees when groupId is given', async () => {
    groupById.mockResolvedValue({
      id: GROUP_ID,
      name: 'Trip',
      note: 'summer',
      userId: 42,
      transactions: [makeTx()],
    } as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: { groupId: GROUP_ID } })) as {
      id: string;
      name: string;
      note: string;
      transactions: { id: string; payee: unknown }[];
    };

    expect(groupById).toHaveBeenCalledWith({ id: GROUP_ID, userId: 42 });
    expect(listGroups).not.toHaveBeenCalled();
    expect(payeeNames).toHaveBeenCalledWith({ userId: 42, payeeIds: [PAYEE_ID] });
    expect(data).toMatchObject({ id: GROUP_ID, name: 'Trip', note: 'summer' });
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ id: TX_ID, payee: { id: PAYEE_ID, name: 'Starbucks' } });
  });

  it('always embeds the transactions for a single group, whatever includeTransactions says', async () => {
    groupById.mockResolvedValue({ id: GROUP_ID, name: 'Trip', note: null, transactions: [makeTx()] } as never);

    const data = (await call({ tool, args: { groupId: GROUP_ID, includeTransactions: false } })) as {
      transactions: unknown[];
    };

    expect(data.transactions).toHaveLength(1);
  });

  it('lets a not-found error through', async () => {
    groupById.mockRejectedValue(new NotFoundError({ message: 'Transaction group not found.' }));

    await expect(call({ tool, args: { groupId: GROUP_ID } })).rejects.toThrow('Transaction group not found.');
  });

  it('keeps listing every group when no groupId is given', async () => {
    listGroups.mockResolvedValue([
      { id: GROUP_ID, name: 'Trip', note: null, transactionCount: 2, dateFrom: null, dateTo: null },
    ] as never);

    const data = (await call({ tool, args: {} })) as { id: string }[];

    expect(groupById).not.toHaveBeenCalled();
    expect(data).toEqual([
      { id: GROUP_ID, name: 'Trip', note: null, transactionCount: 2, dateFrom: null, dateTo: null },
    ]);
  });
});
