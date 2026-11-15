import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// The import chains of the services behind the tools invoked below open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import { getAccounts } from '@services/accounts.service';
import { getCategories } from '@services/categories.service';

import { scopeSentence } from './define-tool';
import {
  findToolCatalogEntry,
  getToolCatalog,
  type ToolCallResult,
  type ToolCatalogEntry,
  type ToolInvokeExtra,
} from './tool-catalog';
import { ALL_TOOLS } from './toolsets';

const findTool = ({ name }: { name: string }): ToolCatalogEntry => findToolCatalogEntry({ name })!;

const textOf = ({ result }: { result: ToolCallResult }) => JSON.parse(result.content[0]!.text);

const readScopeExtra = (): ToolInvokeExtra => ({
  authInfo: {
    token: 'moneymatter-chat:in-process',
    clientId: 'moneymatter-chat',
    scopes: ['finance:read'],
    extra: {
      userId: 42,
      authUserId: 'auth-42',
      username: 'jane',
      role: USER_ROLES.common,
      readOnly: false,
    },
  },
});

describe('findToolCatalogEntry', () => {
  it('finds the entry of a tool by name, and nothing for an unknown name', () => {
    expect(findToolCatalogEntry({ name: 'create_category' })?.name).toBe('create_category');
    expect(findToolCatalogEntry({ name: 'no_such_tool' })).toBeUndefined();
  });
});

describe('getToolCatalog', () => {
  beforeEach(() => {
    jest.mocked(getCategories).mockReset();
    jest.mocked(getAccounts).mockReset();
  });

  it('lists every tool def once, from every toolset', () => {
    const names = getToolCatalog().map((entry) => entry.name);

    expect(names).toEqual(ALL_TOOLS.map((def) => def.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries each def`s toolset, access, input and the description the MCP client sees', () => {
    const wrong = ALL_TOOLS.filter((def) => {
      const entry = findTool({ name: def.name });
      return (
        entry.toolset !== def.toolset ||
        entry.access !== def.access ||
        entry.inputShape !== (def.input ?? null) ||
        entry.description !== def.description + scopeSentence({ def })
      );
    }).map((def) => def.name);

    expect(wrong).toEqual([]);
    expect(findTool({ name: 'create_category' }).description).toMatch(/Requires finance:write scope\.$/);
  });

  it('invokes a tool without input', async () => {
    jest.mocked(getCategories).mockResolvedValue([] as never);

    const result = await findTool({ name: 'get_categories' }).invoke({ extra: readScopeExtra() });

    expect(getCategories).toHaveBeenCalledWith({ userId: 42 });
    expect(textOf({ result })).toEqual([]);
  });

  it('invokes a tool with input', async () => {
    jest.mocked(getAccounts).mockResolvedValue([] as never);

    const entry = findTool({ name: 'get_accounts' });
    expect(entry.inputShape).not.toBeNull();
    const result = await entry.invoke({ args: { includeExcludedFromStats: true }, extra: readScopeExtra() });

    expect(getAccounts).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }));
    expect(textOf({ result })).toEqual([]);
  });

  it('runs a write tool through its own scope guard', async () => {
    await expect(
      findTool({ name: 'create_category' }).invoke({ args: { name: 'Food' }, extra: readScopeExtra() }),
    ).rejects.toThrow(/finance:write/);
  });

  it('refuses a bad input through validateArgs with the tool`s own message, without any guard or I/O', () => {
    expect(() =>
      findTool({ name: 'create_transaction' }).validateArgs({
        args: { accountId: 'a', amount: 1, transactionType: 'expense', payeeId: 'p', merchantName: 'm' },
      }),
    ).toThrow(/"payeeId" and "merchantName" cannot be used together/);
    expect(() => findTool({ name: 'bulk_delete_transactions' }).validateArgs({ args: { filters: {} } })).toThrow(
      /narrowing filter/,
    );
  });

  it('accepts anything through validateArgs for a tool without validate', () => {
    expect(() => findTool({ name: 'get_categories' }).validateArgs({ args: undefined })).not.toThrow();
  });

  it('returns the same frozen array on every call', () => {
    const first = getToolCatalog();

    expect(getToolCatalog()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});
