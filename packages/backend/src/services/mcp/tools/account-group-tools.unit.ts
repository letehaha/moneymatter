import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as groupService from '@services/account-groups';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Blocks the real service, whose import chain builds queues at module scope and would open Redis
// connections in a unit test.
jest.mock('@services/account-groups', () => ({
  getAccountGroups: jest.fn(),
  getAccountsInGroup: jest.fn(),
  createAccountGroup: jest.fn(),
  updateAccountGroup: jest.fn(),
  deleteAccountGroup: jest.fn(),
  addAccountToGroup: jest.fn(),
  removeAccountFromGroup: jest.fn(),
  moveAccountGroup: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerAddAccountToGroup } from './add-account-to-group';
import { registerCreateAccountGroup } from './create-account-group';
import { registerDeleteAccountGroup } from './delete-account-group';
import { registerGetAccountGroups } from './get-account-groups';
import { registerMoveAccountGroup } from './move-account-group';
import { registerRemoveAccountsFromGroup } from './remove-accounts-from-group';
import { registerUpdateAccountGroup } from './update-account-group';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'] });

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const service = jest.mocked(groupService);

const makeAccountRow = ({ id = ACCOUNT_ID }: { id?: string } = {}) => ({
  id,
  name: 'Checking',
  initialBalance: Money.fromDecimal(100),
  refInitialBalance: Money.fromDecimal(100),
  currentBalance: Money.fromDecimal(250.5),
  refCurrentBalance: Money.fromDecimal(250.5),
  creditLimit: Money.fromDecimal(0),
  refCreditLimit: Money.fromDecimal(0),
  type: ACCOUNT_TYPES.system,
  accountCategory: ACCOUNT_CATEGORIES.general,
  currencyCode: 'USD',
  userId: 42,
  externalId: null,
  status: 'active',
  excludeFromStats: false,
  bankDataProviderConnectionId: null,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
});

const makeGroupRow = ({
  id = GROUP_ID,
  name = 'Savings',
  parentGroupId = null,
  accounts,
  childGroups,
}: {
  id?: string;
  name?: string;
  parentGroupId?: string | null;
  accounts?: unknown[];
  childGroups?: unknown[];
} = {}) => ({
  id,
  name,
  userId: 42,
  parentGroupId,
  bankDataProviderConnectionId: null,
  logoDomain: 'example.com',
  logoInitials: null,
  logoColor: null,
  ...(accounts ? { accounts } : {}),
  ...(childGroups ? { childGroups } : {}),
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_account_groups', () => {
  const tool = captureTools({ register: registerGetAccountGroups })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts no filter, each filter and a group id, and rejects malformed ids', () => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ includeArchived: true, accountIds: [ACCOUNT_ID] }).success).toBe(true);
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(true);
    expect(schema.safeParse({ groupId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ accountIds: ['nope'] }).success).toBe(false);
  });

  it('passes the filters on, with no scope helper', async () => {
    service.getAccountGroups.mockResolvedValueOnce([]);

    const result = await tool.handler(
      { includeArchived: true, accountIds: [ACCOUNT_ID] },
      makeExtra({ scopes: ['finance:read'], readOnly: true }),
    );

    expect(service.getAccountGroups).toHaveBeenCalledWith({
      userId: 42,
      includeArchived: true,
      accountIds: [ACCOUNT_ID],
    });
    expect(parseToolResult({ result })).toEqual([]);
  });

  it('returns a flat list where the parent-child relation is explicit, with slimmed accounts', async () => {
    service.getAccountGroups.mockResolvedValueOnce([
      makeGroupRow({
        id: PARENT_ID,
        name: 'Savings',
        accounts: [makeAccountRow()],
        childGroups: [makeGroupRow({ id: CHILD_ID, name: 'Emergency', parentGroupId: PARENT_ID })],
      }),
      makeGroupRow({ id: CHILD_ID, name: 'Emergency', parentGroupId: PARENT_ID, accounts: [] }),
    ] as never);

    const result = await tool.handler({}, makeExtra());
    const [parent, child] = parseToolResult({ result }) as Record<string, unknown>[];

    expect(parent).toMatchObject({
      id: PARENT_ID,
      name: 'Savings',
      parentGroupId: null,
      path: 'Savings',
      childGroups: [{ id: CHILD_ID, name: 'Emergency' }],
      logoDomain: 'example.com',
      accounts: [{ id: ACCOUNT_ID, name: 'Checking', currencyCode: 'USD', currentBalance: 250.5 }],
    });
    expect(child).toMatchObject({
      id: CHILD_ID,
      parentGroupId: PARENT_ID,
      path: 'Savings > Emergency',
      childGroups: [],
      accounts: [],
    });
    expect(parent).not.toHaveProperty('userId');
    expect((parent!.accounts as Record<string, unknown>[])[0]).not.toHaveProperty('userId');
  });

  it('lists the accounts of one group as ids when given a group id', async () => {
    service.getAccountsInGroup.mockResolvedValueOnce([
      { id: 'g1', accountId: ACCOUNT_ID, groupId: GROUP_ID },
      { id: 'g2', accountId: OTHER_ACCOUNT_ID, groupId: GROUP_ID },
    ] as never);

    const result = await tool.handler({ groupId: GROUP_ID }, makeExtra());

    expect(service.getAccountsInGroup).toHaveBeenCalledWith({ groupId: GROUP_ID, userId: 42 });
    expect(service.getAccountGroups).not.toHaveBeenCalled();
    expect(parseToolResult({ result })).toEqual({ groupId: GROUP_ID, accountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] });
  });

  it('rejects a group id combined with a list filter instead of ignoring the filter', async () => {
    await expect(tool.handler({ groupId: GROUP_ID, includeArchived: true }, makeExtra())).rejects.toThrow(/groupId/);
    await expect(tool.handler({ groupId: GROUP_ID, accountIds: [ACCOUNT_ID] }, makeExtra())).rejects.toThrow(/groupId/);
    expect(service.getAccountsInGroup).not.toHaveBeenCalled();
  });
});

describe('create_account_group', () => {
  const tool = captureTools({ register: registerCreateAccountGroup })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts a name, a nullable parent and logo fields', () => {
    expect(schema.safeParse({ name: 'Savings' }).success).toBe(true);
    expect(schema.safeParse({ name: 'Savings', parentGroupId: null }).success).toBe(true);
    expect(schema.safeParse({ name: 'Emergency', parentGroupId: PARENT_ID, logoDomain: 'example.com' }).success).toBe(
      true,
    );
  });

  it.each([
    { label: 'a missing name', input: {} },
    { label: 'an empty name', input: { name: '' } },
    { label: 'a malformed parent id', input: { name: 'x', parentGroupId: 'nope' } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('rejects a brand domain together with monogram letters, and a color without letters', async () => {
    await expect(tool.handler({ name: 'x', logoDomain: 'example.com', logoInitials: 'AB' }, WRITE)).rejects.toThrow();
    await expect(tool.handler({ name: 'x', logoColor: '#ff0000' }, WRITE)).rejects.toThrow();
    expect(service.createAccountGroup).not.toHaveBeenCalled();
  });

  it('creates the group and returns it with its parent id', async () => {
    service.createAccountGroup.mockResolvedValueOnce(
      makeGroupRow({ id: CHILD_ID, name: 'Emergency', parentGroupId: PARENT_ID }) as never,
    );

    const result = await tool.handler(
      { name: 'Emergency', parentGroupId: PARENT_ID, logoDomain: 'example.com' },
      WRITE,
    );

    expect(service.createAccountGroup).toHaveBeenCalledWith({
      userId: 42,
      name: 'Emergency',
      parentGroupId: PARENT_ID,
      logoDomain: 'example.com',
    });
    const group = parseToolResult({ result }) as Record<string, unknown>;
    expect(group).toMatchObject({ id: CHILD_ID, name: 'Emergency', parentGroupId: PARENT_ID });
    expect(group).not.toHaveProperty('userId');
  });
});

describe('update_account_group', () => {
  const tool = captureTools({ register: registerUpdateAccountGroup })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('requires the group id, makes every other field optional and accepts nulls to clear', () => {
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(true);
    expect(schema.safeParse({ groupId: GROUP_ID, name: 'Renamed' }).success).toBe(true);
    expect(
      schema.safeParse({
        groupId: GROUP_ID,
        parentGroupId: null,
        logoDomain: null,
        logoInitials: null,
        logoColor: null,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ name: 'Renamed' }).success).toBe(false);
    expect(schema.safeParse({ groupId: GROUP_ID, name: '' }).success).toBe(false);
  });

  it('rejects a brand domain together with monogram letters', async () => {
    await expect(
      tool.handler({ groupId: GROUP_ID, logoDomain: 'example.com', logoInitials: 'AB' }, WRITE),
    ).rejects.toThrow();
    expect(service.updateAccountGroup).not.toHaveBeenCalled();
  });

  it('updates the group and returns the single group, not a list', async () => {
    service.updateAccountGroup.mockResolvedValueOnce(
      makeGroupRow({ name: 'Renamed', parentGroupId: PARENT_ID }) as never,
    );

    const result = await tool.handler({ groupId: GROUP_ID, name: 'Renamed', parentGroupId: PARENT_ID }, WRITE);

    expect(service.updateAccountGroup).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      userId: 42,
      name: 'Renamed',
      parentGroupId: PARENT_ID,
    });
    const group = parseToolResult({ result });
    expect(Array.isArray(group)).toBe(false);
    expect(group).toMatchObject({ id: GROUP_ID, name: 'Renamed', parentGroupId: PARENT_ID });
  });

  it('passes a null parent through to move the group to the top level', async () => {
    service.updateAccountGroup.mockResolvedValueOnce(makeGroupRow() as never);

    await tool.handler({ groupId: GROUP_ID, parentGroupId: null }, WRITE);

    expect(service.updateAccountGroup).toHaveBeenCalledWith({ groupId: GROUP_ID, userId: 42, parentGroupId: null });
  });
});

describe('delete_account_group', () => {
  const tool = captureTools({ register: registerDeleteAccountGroup })[0]!;

  it('requires the finance:delete scope: the write scope alone is refused', async () => {
    await expect(tool.handler({ groupId: GROUP_ID }, WRITE)).rejects.toThrow(/Missing required scope: finance:delete/);
    expect(service.deleteAccountGroup).not.toHaveBeenCalled();
  });

  it('deletes the group and says so', async () => {
    service.deleteAccountGroup.mockResolvedValueOnce(undefined as never);

    const result = await tool.handler({ groupId: GROUP_ID }, DELETE);

    expect(service.deleteAccountGroup).toHaveBeenCalledWith({ groupId: GROUP_ID, userId: 42 });
    expect(parseToolResult({ result })).toEqual({ deleted: true, groupId: GROUP_ID });
  });

  it('describes that the accounts are kept', () => {
    expect(tool.config.description).toMatch(/accounts.*(kept|not deleted)/i);
  });
});

describe('add_account_to_group', () => {
  const tool = captureTools({ register: registerAddAccountToGroup })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('requires both ids', () => {
    expect(schema.safeParse({ groupId: GROUP_ID, accountId: ACCOUNT_ID }).success).toBe(true);
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(false);
    expect(schema.safeParse({ accountId: ACCOUNT_ID }).success).toBe(false);
  });

  it('adds the account and returns the membership', async () => {
    service.addAccountToGroup.mockResolvedValueOnce({ id: 'g1', accountId: ACCOUNT_ID, groupId: GROUP_ID } as never);

    const result = await tool.handler({ groupId: GROUP_ID, accountId: ACCOUNT_ID }, WRITE);

    expect(service.addAccountToGroup).toHaveBeenCalledWith({ groupId: GROUP_ID, accountId: ACCOUNT_ID, userId: 42 });
    expect(parseToolResult({ result })).toEqual({ groupId: GROUP_ID, accountId: ACCOUNT_ID });
  });

  it('says that an account is in one group at a time', () => {
    expect(tool.config.description).toMatch(/one group/i);
  });
});

describe('remove_accounts_from_group', () => {
  const tool = captureTools({ register: registerRemoveAccountsFromGroup })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('requires the group id and a list of account ids', () => {
    expect(schema.safeParse({ groupId: GROUP_ID, accountIds: [ACCOUNT_ID] }).success).toBe(true);
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(false);
    expect(schema.safeParse({ groupId: GROUP_ID, accountIds: ['nope'] }).success).toBe(false);
  });

  it('removes the accounts and says which', async () => {
    service.removeAccountFromGroup.mockResolvedValueOnce(undefined as never);

    const result = await tool.handler({ groupId: GROUP_ID, accountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] }, WRITE);

    expect(service.removeAccountFromGroup).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      accountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
      userId: 42,
    });
    expect(parseToolResult({ result })).toEqual({
      removed: true,
      groupId: GROUP_ID,
      accountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
    });
  });
});

describe('move_account_group', () => {
  const tool = captureTools({ register: registerMoveAccountGroup })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('requires an explicit new parent, which may be null for the top level', () => {
    expect(schema.safeParse({ groupId: GROUP_ID, newParentGroupId: PARENT_ID }).success).toBe(true);
    expect(schema.safeParse({ groupId: GROUP_ID, newParentGroupId: null }).success).toBe(true);
    expect(schema.safeParse({ groupId: GROUP_ID }).success).toBe(false);
    expect(schema.safeParse({ groupId: GROUP_ID, newParentGroupId: 'nope' }).success).toBe(false);
  });

  it('moves the group under the new parent and returns it', async () => {
    service.moveAccountGroup.mockResolvedValueOnce([1, [makeGroupRow({ parentGroupId: PARENT_ID })]] as never);

    const result = await tool.handler({ groupId: GROUP_ID, newParentGroupId: PARENT_ID }, WRITE);

    expect(service.moveAccountGroup).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      newParentGroupId: PARENT_ID,
      userId: 42,
    });
    expect(parseToolResult({ result })).toMatchObject({ id: GROUP_ID, parentGroupId: PARENT_ID });
  });

  it('moves the group to the top level with a null parent', async () => {
    service.moveAccountGroup.mockResolvedValueOnce([1, [makeGroupRow()]] as never);

    const result = await tool.handler({ groupId: GROUP_ID, newParentGroupId: null }, WRITE);

    expect(service.moveAccountGroup).toHaveBeenCalledWith({ groupId: GROUP_ID, newParentGroupId: null, userId: 42 });
    expect(parseToolResult({ result })).toMatchObject({ id: GROUP_ID, parentGroupId: null });
  });

  it('throws not found when nothing was updated', async () => {
    service.moveAccountGroup.mockResolvedValueOnce([0, []] as never);

    await expect(tool.handler({ groupId: GROUP_ID, newParentGroupId: null }, WRITE)).rejects.toThrow(
      /accounts.groupNotFound/,
    );
  });

  it('says it moves a group, not an account', () => {
    expect(tool.config.description).toMatch(/not an account/i);
  });
});

describe('write guards', () => {
  const cases = [
    {
      name: 'create_account_group',
      register: registerCreateAccountGroup,
      args: { name: 'Savings' },
      mocked: () => service.createAccountGroup,
    },
    {
      name: 'update_account_group',
      register: registerUpdateAccountGroup,
      args: { groupId: GROUP_ID, name: 'Renamed' },
      mocked: () => service.updateAccountGroup,
    },
    {
      name: 'add_account_to_group',
      register: registerAddAccountToGroup,
      args: { groupId: GROUP_ID, accountId: ACCOUNT_ID },
      mocked: () => service.addAccountToGroup,
    },
    {
      name: 'remove_accounts_from_group',
      register: registerRemoveAccountsFromGroup,
      args: { groupId: GROUP_ID, accountIds: [ACCOUNT_ID] },
      mocked: () => service.removeAccountFromGroup,
    },
    {
      name: 'move_account_group',
      register: registerMoveAccountGroup,
      args: { groupId: GROUP_ID, newParentGroupId: null },
      mocked: () => service.moveAccountGroup,
    },
  ];

  it.each(cases)('$name is refused without the write scope, for read-only and for demo users', async (c) => {
    const tool = captureTools({ register: c.register })[0]!;
    expect(tool.name).toBe(c.name);

    await expect(tool.handler(c.args, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(c.args, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler(c.args, makeExtra({ scopes: ['finance:write'], role: 'demo' }))).rejects.toThrow(
      /demo mode/,
    );
    expect(c.mocked()).not.toHaveBeenCalled();
  });

  it.each([
    ...cases,
    {
      name: 'delete_account_group',
      register: registerDeleteAccountGroup,
      args: { groupId: GROUP_ID },
      mocked: () => service.deleteAccountGroup,
    },
  ])('$name is refused while the base-currency lock is set', async (c) => {
    lockCheck.mockResolvedValueOnce(true);
    const tool = captureTools({ register: c.register })[0]!;

    await expect(tool.handler(c.args, makeExtra())).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(c.mocked()).not.toHaveBeenCalled();
  });

  it('delete_account_group is refused for read-only and demo users', async () => {
    const tool = captureTools({ register: registerDeleteAccountGroup })[0]!;

    await expect(tool.handler({ groupId: GROUP_ID }, makeExtra({ readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler({ groupId: GROUP_ID }, makeExtra({ role: 'demo' }))).rejects.toThrow(/demo mode/);
    expect(service.deleteAccountGroup).not.toHaveBeenCalled();
  });
});
