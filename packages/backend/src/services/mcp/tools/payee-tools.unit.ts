import { CATEGORIZATION_MODE } from '@bt/shared/types';
import {
  addIgnoredNameBodySchema,
  bulkDeletePayeesBodySchema,
  bulkUpdateCategorizationModeBodySchema,
  createPayeeAliasBodySchema,
  MAX_BULK_DELETE_PAYEE_IDS,
  updatePayeeBodyShape,
} from '@controllers/payees/shared-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  addPayeeIgnoredName,
  applyPayeeTagsToExisting,
  bulkDeletePayees,
  bulkUpdateCategorizationMode,
  createPayeeAlias,
  deletePayeeAlias,
  listPayeeIgnoredNames,
  removePayeeIgnoredName,
  updatePayee,
} from '@services/payees';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real service, whose import chain builds queues at module scope and would open Redis
// connections in a unit test.
jest.mock('@services/payees', () => ({
  updatePayee: jest.fn(),
  bulkUpdateCategorizationMode: jest.fn(),
  bulkDeletePayees: jest.fn(),
  listPayeeIgnoredNames: jest.fn(),
  addPayeeIgnoredName: jest.fn(),
  removePayeeIgnoredName: jest.fn(),
  applyPayeeTagsToExisting: jest.fn(),
  createPayeeAlias: jest.fn(),
  deletePayeeAlias: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerApplyPayeeTagsToTransactions } from './apply-payee-tags-to-transactions';
import { registerBulkDeletePayees } from './bulk-delete-payees';
import { registerCreatePayeeAlias } from './create-payee-alias';
import { registerDeletePayeeAlias } from './delete-payee-alias';
import { registerGetIgnoredPayeeNames } from './get-ignored-payee-names';
import { registerIgnorePayeeName } from './ignore-payee-name';
import { registerSetPayeesCategorizationMode } from './set-payees-categorization-mode';
import { registerUnignorePayeeName } from './unignore-payee-name';
import { registerUpdatePayee } from './update-payee';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const WRITE_DELETE = makeExtra({ scopes: ['finance:read', 'finance:write', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const update = jest.mocked(updatePayee);
const setMode = jest.mocked(bulkUpdateCategorizationMode);
const bulkDelete = jest.mocked(bulkDeletePayees);
const listIgnored = jest.mocked(listPayeeIgnoredNames);
const addIgnored = jest.mocked(addPayeeIgnoredName);
const removeIgnored = jest.mocked(removePayeeIgnoredName);
const applyTags = jest.mocked(applyPayeeTagsToExisting);
const addAlias = jest.mocked(createPayeeAlias);
const removeAlias = jest.mocked(deletePayeeAlias);

const PAYEE_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const TAG_ID = '33333333-3333-4333-8333-333333333333';
const ALIAS_ID = '44444444-4444-4444-8444-444444444444';
const IGNORED_ID = '55555555-5555-4555-8555-555555555555';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const ids = (count: number) =>
  Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

const makePayee = (patch: Record<string, unknown> = {}) => ({
  id: PAYEE_ID,
  userId: 42,
  name: 'Netflix',
  normalizedName: 'netflix',
  defaultCategoryId: CATEGORY_ID,
  categorizationMode: CATEGORIZATION_MODE.enforce,
  defaultTags: [{ id: TAG_ID, name: 'media' }],
  defaultLocation: { latitude: 52.5, longitude: 13.4 },
  logoDomain: 'netflix.com',
  logoInitials: null,
  logoColor: null,
  logoSource: 'manual',
  aliases: [{ id: ALIAS_ID, payeeId: PAYEE_ID, rawName: 'NFLX', normalizedName: 'nflx' }],
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('update_payee', () => {
  const tool = captureTools({ register: registerUpdatePayee })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and declares the id plus every field of the REST body schema', () => {
    expect(tool.name).toBe('update_payee');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      ['id', ...Object.keys(updatePayeeBodyShape)].toSorted(),
    );
  });

  it('accepts the new fields and applies the REST validation to them', () => {
    expect(
      schema.safeParse({
        id: PAYEE_ID,
        categorizationMode: CATEGORIZATION_MODE.hint,
        defaultTagIds: [TAG_ID],
        defaultLocation: { latitude: 1, longitude: 2 },
        logoDomain: 'netflix.com',
        logoColor: '#AABBCC',
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ id: PAYEE_ID, defaultLocation: null, defaultTagIds: [] }).success).toBe(true);
    expect(schema.safeParse({ id: PAYEE_ID, categorizationMode: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ id: PAYEE_ID, defaultTagIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ id: PAYEE_ID, defaultLocation: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(schema.safeParse({ id: PAYEE_ID, logoColor: 'red' }).success).toBe(false);
    expect(schema.safeParse({ id: PAYEE_ID, name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ id: PAYEE_ID, name: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ id: PAYEE_ID, defaultCategoryId: 'nope' }).success).toBe(false);
  });

  it('passes every field to the service, leaving absent ones undefined', async () => {
    update.mockResolvedValue(makePayee() as never);

    await call({
      tool,
      args: {
        id: PAYEE_ID,
        name: 'Netflix',
        defaultCategoryId: CATEGORY_ID,
        categorizationMode: CATEGORIZATION_MODE.hint,
        defaultTagIds: [TAG_ID],
        defaultLocation: { latitude: 52.5, longitude: 13.4 },
        logoDomain: 'netflix.com',
        logoInitials: null,
        logoColor: null,
      },
      extra: WRITE,
    });

    expect(update).toHaveBeenCalledWith({
      userId: 42,
      id: PAYEE_ID,
      name: 'Netflix',
      defaultCategoryId: CATEGORY_ID,
      categorizationMode: CATEGORIZATION_MODE.hint,
      defaultTagIds: [TAG_ID],
      defaultLocation: { latitude: 52.5, longitude: 13.4 },
      logoDomain: 'netflix.com',
      logoInitials: null,
      logoColor: null,
    });

    update.mockClear();
    await call({ tool, args: { id: PAYEE_ID, name: 'Only name' }, extra: WRITE });
    expect(update).toHaveBeenCalledWith({
      userId: 42,
      id: PAYEE_ID,
      name: 'Only name',
      defaultCategoryId: undefined,
      categorizationMode: undefined,
      defaultTagIds: undefined,
      defaultLocation: undefined,
      logoDomain: undefined,
      logoInitials: undefined,
      logoColor: undefined,
    });
  });

  it('clears the default location and the default tags when given null and []', async () => {
    update.mockResolvedValue(makePayee({ defaultLocation: null, defaultTags: [] }) as never);

    const data = await call({
      tool,
      args: { id: PAYEE_ID, defaultLocation: null, defaultTagIds: [] },
      extra: WRITE,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ defaultLocation: null, defaultTagIds: [] }));
    expect(data).toMatchObject({ defaultLocation: null, defaultTagIds: [] });
  });

  it('refuses a brand image and a monogram together, as REST does, before the service', async () => {
    await expect(
      call({ tool, args: { id: PAYEE_ID, logoDomain: 'netflix.com', logoInitials: 'NF' }, extra: WRITE }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns the payee with its mode, default tags, location and logo, still with id, name and category', async () => {
    update.mockResolvedValue(makePayee() as never);

    const data = await call({ tool, args: { id: PAYEE_ID, name: 'Netflix' }, extra: WRITE });

    expect(data).toMatchObject({
      id: PAYEE_ID,
      name: 'Netflix',
      defaultCategoryId: CATEGORY_ID,
      categorizationMode: CATEGORIZATION_MODE.enforce,
      defaultTagIds: [TAG_ID],
      defaultLocation: { latitude: 52.5, longitude: 13.4 },
      logoDomain: 'netflix.com',
      logoInitials: null,
      logoColor: null,
    });
    expect(data).not.toHaveProperty('userId');
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { id: PAYEE_ID }, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { id: PAYEE_ID }, extra: READ_ONLY })).rejects.toThrow(
      /no longer includes editing/,
    );

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: { id: PAYEE_ID }, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('set_payees_categorization_mode', () => {
  const tool = captureTools({ register: registerSetPayeesCategorizationMode })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and declares the fields of the REST body schema', () => {
    expect(tool.name).toBe('set_payees_categorization_mode');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      Object.keys(bulkUpdateCategorizationModeBodySchema.shape).toSorted(),
    );
    for (const mode of Object.values(CATEGORIZATION_MODE)) {
      expect(schema.safeParse({ mode }).success).toBe(true);
    }
    expect(schema.safeParse({ mode: 'nope' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('says in its description that it applies to every payee', () => {
    expect(tool.config.description).toMatch(/every payee/i);
  });

  it('sets the mode for the caller and returns the count', async () => {
    setMode.mockResolvedValue({ updatedCount: 7 });

    const data = await call({ tool, args: { mode: CATEGORIZATION_MODE.off }, extra: WRITE });

    expect(setMode).toHaveBeenCalledWith({ userId: 42, mode: CATEGORIZATION_MODE.off });
    expect(data).toEqual({ updatedCount: 7 });
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { mode: 'off' }, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { mode: 'off' }, extra: READ_ONLY })).rejects.toThrow(/no longer includes editing/);

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: { mode: 'off' }, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(setMode).not.toHaveBeenCalled();
  });
});

describe('bulk_delete_payees', () => {
  const tool = captureTools({ register: registerBulkDeletePayees })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and declares the fields of the REST body schema', () => {
    expect(tool.name).toBe('bulk_delete_payees');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      Object.keys(bulkDeletePayeesBodySchema.shape).toSorted(),
    );
  });

  it('takes 1 to 2000 unique ids', () => {
    expect(schema.safeParse({ ids: [PAYEE_ID] }).success).toBe(true);
    expect(schema.safeParse({ ids: ids(MAX_BULK_DELETE_PAYEE_IDS) }).success).toBe(true);
    expect(schema.safeParse({ ids: ids(MAX_BULK_DELETE_PAYEE_IDS + 1) }).success).toBe(false);
    expect(schema.safeParse({ ids: [] }).success).toBe(false);
    expect(schema.safeParse({ ids: [PAYEE_ID, PAYEE_ID] }).success).toBe(false);
    expect(schema.safeParse({ ids: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('deletes the ids, not ignoring their names unless asked', async () => {
    bulkDelete.mockResolvedValue({ deletedCount: 1, ignoredAddedCount: 0 });

    const data = await call({ tool, args: { ids: [PAYEE_ID] }, extra: WRITE_DELETE });

    expect(bulkDelete).toHaveBeenCalledWith({ userId: 42, ids: [PAYEE_ID], ignoreFuture: false });
    expect(data).toEqual({ deletedCount: 1, ignoredAddedCount: 0 });
  });

  it('passes ignoreFuture through', async () => {
    bulkDelete.mockResolvedValue({ deletedCount: 1, ignoredAddedCount: 3 });

    const data = await call({ tool, args: { ids: [PAYEE_ID], ignoreFuture: true }, extra: WRITE_DELETE });

    expect(bulkDelete).toHaveBeenCalledWith({ userId: 42, ids: [PAYEE_ID], ignoreFuture: true });
    expect(data).toEqual({ deletedCount: 1, ignoredAddedCount: 3 });
  });

  it('needs finance:delete and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { ids: [PAYEE_ID] }, extra: WRITE })).rejects.toThrow(
      /Missing required scope: finance:delete/,
    );
    await expect(call({ tool, args: { ids: [PAYEE_ID] }, extra: READ_ONLY })).rejects.toThrow(
      /no longer includes editing/,
    );

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: { ids: [PAYEE_ID] }, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(bulkDelete).not.toHaveBeenCalled();
  });
});

describe('get_ignored_payee_names', () => {
  const tool = captureTools({ register: registerGetIgnoredPayeeNames })[0]!;

  it('registers under its name and takes no input', () => {
    expect(tool.name).toBe('get_ignored_payee_names');
    expect(tool.config.inputSchema ?? {}).toEqual({});
  });

  it('returns the ignored names with ISO dates, to a read-only user and without a lock check', async () => {
    lockCheck.mockResolvedValue(true);
    listIgnored.mockResolvedValue([
      {
        id: IGNORED_ID,
        userId: 42,
        normalizedName: 'переказ на картку',
        rawSample: 'Переказ на картку',
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ] as never);

    const data = await call({ tool, extra: READ_ONLY });

    expect(listIgnored).toHaveBeenCalledWith({ userId: 42 });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual([
      {
        id: IGNORED_ID,
        normalizedName: 'переказ на картку',
        rawSample: 'Переказ на картку',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
  });

  it('returns an empty list when nothing is ignored', async () => {
    listIgnored.mockResolvedValue([]);

    expect(await call({ tool, extra: READ_ONLY })).toEqual([]);
  });
});

describe('ignore_payee_name', () => {
  const tool = captureTools({ register: registerIgnorePayeeName })[0]!;
  const schema = z.object(tool.config.inputSchema!);
  const row = {
    id: IGNORED_ID,
    userId: 42,
    normalizedName: 'glovo',
    rawSample: 'Glovo',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
  };

  it('registers under its name and declares the fields of the REST body schema', () => {
    expect(tool.name).toBe('ignore_payee_name');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      Object.keys(addIgnoredNameBodySchema.shape).toSorted(),
    );
    expect(schema.safeParse({ rawName: 'Glovo' }).success).toBe(true);
    expect(schema.safeParse({ rawName: 'Glovo', force: true }).success).toBe(true);
    expect(schema.safeParse({ rawName: '   ' }).success).toBe(false);
    expect(schema.safeParse({ rawName: 'x'.repeat(501) }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('says that force deletes the matching payee, which needs finance:delete', () => {
    expect(tool.config.description).toMatch(/force/);
    expect(tool.config.description).toMatch(/finance:delete/);
  });

  it('lets a write-only token ignore a name without force', async () => {
    addIgnored.mockResolvedValue(row as never);

    const data = await call({ tool, args: { rawName: 'Glovo' }, extra: WRITE });

    expect(addIgnored).toHaveBeenCalledWith({ userId: 42, rawName: 'Glovo', force: false });
    expect(data).toEqual({
      id: IGNORED_ID,
      normalizedName: 'glovo',
      rawSample: 'Glovo',
      createdAt: '2026-10-01T10:00:00.000Z',
    });

    addIgnored.mockClear();
    await call({ tool, args: { rawName: 'Glovo', force: false }, extra: WRITE });
    expect(addIgnored).toHaveBeenCalledWith({ userId: 42, rawName: 'Glovo', force: false });
  });

  it('refuses force for a write-only token and never reaches the service', async () => {
    await expect(call({ tool, args: { rawName: 'Glovo', force: true }, extra: WRITE })).rejects.toThrow(
      /Missing required scope: finance:delete/,
    );
    expect(addIgnored).not.toHaveBeenCalled();
  });

  it('lets a token with finance:delete use force', async () => {
    addIgnored.mockResolvedValue(row as never);

    await call({ tool, args: { rawName: 'Glovo', force: true }, extra: WRITE_DELETE });

    expect(addIgnored).toHaveBeenCalledWith({ userId: 42, rawName: 'Glovo', force: true });
  });

  it('needs finance:write even with finance:delete, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { rawName: 'Glovo', force: true }, extra: DELETE_ONLY })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { rawName: 'Glovo' }, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { rawName: 'Glovo' }, extra: READ_ONLY })).rejects.toThrow(
      /no longer includes editing/,
    );
    expect(addIgnored).not.toHaveBeenCalled();
  });

  it('checks the base-currency lock', async () => {
    lockCheck.mockResolvedValue(true);

    await expect(call({ tool, args: { rawName: 'Glovo' }, extra: WRITE })).rejects.toThrow(LOCKED);
    await expect(call({ tool, args: { rawName: 'Glovo', force: true }, extra: WRITE_DELETE })).rejects.toThrow(LOCKED);
    expect(addIgnored).not.toHaveBeenCalled();
  });

  it('passes the service conflict through when the name still resolves to a payee and force is off', async () => {
    addIgnored.mockRejectedValue(new Error('payees.ignoredNameCollidesWithPayee'));

    await expect(call({ tool, args: { rawName: 'Glovo' }, extra: WRITE })).rejects.toThrow(
      'payees.ignoredNameCollidesWithPayee',
    );
  });
});

describe('unignore_payee_name', () => {
  const tool = captureTools({ register: registerUnignorePayeeName })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and takes the ignored-name id', () => {
    expect(tool.name).toBe('unignore_payee_name');
    expect(Object.keys(tool.config.inputSchema!)).toEqual(['ignoredNameId']);
    expect(schema.safeParse({ ignoredNameId: IGNORED_ID }).success).toBe(true);
    expect(schema.safeParse({ ignoredNameId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('removes the ignored name for the caller', async () => {
    removeIgnored.mockResolvedValue(undefined);

    const data = await call({ tool, args: { ignoredNameId: IGNORED_ID }, extra: WRITE });

    expect(removeIgnored).toHaveBeenCalledWith({ userId: 42, id: IGNORED_ID });
    expect(data).toEqual({ deleted: true, ignoredNameId: IGNORED_ID });
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { ignoredNameId: IGNORED_ID }, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { ignoredNameId: IGNORED_ID }, extra: READ_ONLY })).rejects.toThrow(
      /no longer includes editing/,
    );

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: { ignoredNameId: IGNORED_ID }, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(removeIgnored).not.toHaveBeenCalled();
  });
});

describe('apply_payee_tags_to_transactions', () => {
  const tool = captureTools({ register: registerApplyPayeeTagsToTransactions })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and takes the payee id', () => {
    expect(tool.name).toBe('apply_payee_tags_to_transactions');
    expect(Object.keys(tool.config.inputSchema!)).toEqual(['payeeId']);
    expect(schema.safeParse({ payeeId: PAYEE_ID }).success).toBe(true);
    expect(schema.safeParse({ payeeId: 'nope' }).success).toBe(false);
  });

  it('applies the default tags and returns the count', async () => {
    applyTags.mockResolvedValue({ updatedTransactionsCount: 12 });

    const data = await call({ tool, args: { payeeId: PAYEE_ID }, extra: WRITE });

    expect(applyTags).toHaveBeenCalledWith({ userId: 42, payeeId: PAYEE_ID });
    expect(data).toEqual({ updatedTransactionsCount: 12 });
  });

  it('says it only adds tags', () => {
    expect(tool.config.description).toMatch(/never removes/i);
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { payeeId: PAYEE_ID }, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { payeeId: PAYEE_ID }, extra: READ_ONLY })).rejects.toThrow(
      /no longer includes editing/,
    );

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: { payeeId: PAYEE_ID }, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(applyTags).not.toHaveBeenCalled();
  });
});

describe('create_payee_alias', () => {
  const tool = captureTools({ register: registerCreatePayeeAlias })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and declares the payee id plus the fields of the REST body schema', () => {
    expect(tool.name).toBe('create_payee_alias');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      ['payeeId', ...Object.keys(createPayeeAliasBodySchema.shape)].toSorted(),
    );
    expect(schema.safeParse({ payeeId: PAYEE_ID, rawName: 'NFLX' }).success).toBe(true);
    expect(schema.safeParse({ payeeId: PAYEE_ID, rawName: '  ' }).success).toBe(false);
    expect(schema.safeParse({ payeeId: PAYEE_ID, rawName: 'x'.repeat(501) }).success).toBe(false);
    expect(schema.safeParse({ rawName: 'NFLX' }).success).toBe(false);
  });

  it('adds the alias and returns the payee with its aliases', async () => {
    addAlias.mockResolvedValue(makePayee() as never);

    const data = await call({ tool, args: { payeeId: PAYEE_ID, rawName: 'NFLX' }, extra: WRITE });

    expect(addAlias).toHaveBeenCalledWith({ userId: 42, payeeId: PAYEE_ID, rawName: 'NFLX' });
    expect(data).toMatchObject({
      id: PAYEE_ID,
      name: 'Netflix',
      aliases: [{ id: ALIAS_ID, rawName: 'NFLX', normalizedName: 'nflx' }],
    });
    expect(data).not.toHaveProperty('userId');
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    const args = { payeeId: PAYEE_ID, rawName: 'NFLX' };
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/Missing required scope: finance:write/);
    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow(/no longer includes editing/);

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(addAlias).not.toHaveBeenCalled();
  });
});

describe('delete_payee_alias', () => {
  const tool = captureTools({ register: registerDeletePayeeAlias })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and takes the payee id and the alias id', () => {
    expect(tool.name).toBe('delete_payee_alias');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(['aliasId', 'payeeId']);
    expect(schema.safeParse({ payeeId: PAYEE_ID, aliasId: ALIAS_ID }).success).toBe(true);
    expect(schema.safeParse({ payeeId: PAYEE_ID }).success).toBe(false);
    expect(schema.safeParse({ payeeId: PAYEE_ID, aliasId: 'nope' }).success).toBe(false);
  });

  it('removes the alias for the caller', async () => {
    removeAlias.mockResolvedValue(undefined);

    const data = await call({ tool, args: { payeeId: PAYEE_ID, aliasId: ALIAS_ID }, extra: WRITE_DELETE });

    expect(removeAlias).toHaveBeenCalledWith({ userId: 42, payeeId: PAYEE_ID, aliasId: ALIAS_ID });
    expect(data).toEqual({ deleted: true, aliasId: ALIAS_ID });
  });

  it('needs finance:delete and an unlocked base currency, and refuses a read-only user', async () => {
    const args = { payeeId: PAYEE_ID, aliasId: ALIAS_ID };
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/Missing required scope: finance:delete/);
    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow(/no longer includes editing/);

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(removeAlias).not.toHaveBeenCalled();
  });
});
