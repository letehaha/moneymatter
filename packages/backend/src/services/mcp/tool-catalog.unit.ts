import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// The import chains of the services behind the two tools invoked below open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import { getAccounts } from '@services/accounts.service';
import { getCategories } from '@services/categories.service';

import {
  findToolCatalogEntry,
  getToolCatalog,
  type ToolCallResult,
  type ToolCatalogEntry,
  type ToolInvokeExtra,
} from './tool-catalog';
import { READ_TOOL_NAME } from './tool-classification';

const TOOLS_DIR = path.join(__dirname, 'tools');
const SERVER_CARD_PATH = path.resolve(__dirname, '../../../../frontend/public/.well-known/mcp/server-card.json');

const findTool = ({ name }: { name: string }): ToolCatalogEntry => getToolCatalog().find((tool) => tool.name === name)!;

const textOf = ({ result }: { result: ToolCallResult }) => JSON.parse(result.content[0]!.text);

const cardToolNames = (): string[] =>
  (JSON.parse(fs.readFileSync(SERVER_CARD_PATH, 'utf-8')) as { tools: Array<{ name: string }> }).tools.map(
    (tool) => tool.name,
  );

/** Names of the tools whose source registers a handler that takes only `extra`. */
function toolsRegisteredWithoutInput(): string[] {
  const names: string[] = [];
  for (const entry of fs.readdirSync(TOOLS_DIR)) {
    if (!entry.endsWith('.ts') || entry.includes('.unit.') || entry.includes('.e2e.')) continue;
    const content = fs.readFileSync(path.join(TOOLS_DIR, entry), 'utf-8');
    const name = content.match(/server\.registerTool\(\s*['"]([^'"]+)['"]/)?.[1];
    if (name && /async \(extra\) =>/.test(content)) names.push(name);
  }
  return names.toSorted();
}

const readOnlyExtra = (): ToolInvokeExtra => ({
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
    expect(findToolCatalogEntry({ name: 'create_category' })).toBe(findTool({ name: 'create_category' }));
    expect(findToolCatalogEntry({ name: 'no_such_tool' })).toBeUndefined();
  });
});

describe('getToolCatalog', () => {
  beforeEach(() => {
    jest.mocked(getCategories).mockReset();
    jest.mocked(getAccounts).mockReset();
  });

  it('lists exactly the tools of the server card', () => {
    const names = getToolCatalog().map((entry) => entry.name);

    expect(names).toHaveLength(251);
    expect(names.toSorted()).toEqual(cardToolNames().toSorted());
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a description and an invoke function', () => {
    expect(getToolCatalog().length).toBeGreaterThan(0);
    const broken = getToolCatalog()
      .filter((entry) => !entry.description || typeof entry.invoke !== 'function')
      .map((entry) => entry.name);

    expect(broken).toEqual([]);
  });

  it('has a null inputShape exactly for the tools registered without an inputSchema', () => {
    const withoutShape = getToolCatalog()
      .filter((entry) => entry.inputShape === null)
      .map((entry) => entry.name)
      .toSorted();

    expect(withoutShape).toHaveLength(15);
    expect(withoutShape).toEqual(toolsRegisteredWithoutInput());
  });

  it('classifies access by the tool name rule', () => {
    const wrong = getToolCatalog()
      .filter((entry) => entry.access !== (READ_TOOL_NAME.test(entry.name) ? 'read' : 'write'))
      .map((entry) => entry.name);

    expect(wrong).toEqual([]);
    expect(getToolCatalog().filter((entry) => entry.access === 'read').length).toBeGreaterThan(50);
  });

  it('invokes a tool without input as handler(extra)', async () => {
    jest.mocked(getCategories).mockResolvedValue([] as never);

    const entry = findTool({ name: 'get_categories' });
    expect(entry).toBeDefined();
    const result = await entry.invoke({ extra: readOnlyExtra() });

    expect(getCategories).toHaveBeenCalledWith({ userId: 42 });
    expect(textOf({ result })).toEqual([]);
  });

  it('invokes a tool with input as handler(args, extra)', async () => {
    jest.mocked(getAccounts).mockResolvedValue([] as never);

    const entry = findTool({ name: 'get_accounts' });
    expect(entry).toBeDefined();
    expect(entry.inputShape).not.toBeNull();
    const result = await entry.invoke({ args: { includeExcludedFromStats: true }, extra: readOnlyExtra() });

    expect(getAccounts).toHaveBeenCalledWith({ userId: 42 });
    expect(textOf({ result })).toEqual([]);
  });

  it('runs a write tool through its own scope guard when given a read-only extra', async () => {
    const entry = findTool({ name: 'create_category' });
    expect(entry).toBeDefined();

    await expect(entry.invoke({ args: { name: 'Food' }, extra: readOnlyExtra() })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
  });

  it('exposes validateArgs on every entry, backed by the validator registry', () => {
    expect(getToolCatalog().every((entry) => typeof entry.validateArgs === 'function')).toBe(true);
  });

  it('refuses a bad input through validateArgs with the validator message, without any guard or I/O', () => {
    const entry = findTool({ name: 'create_transaction' });

    expect(() =>
      entry.validateArgs({ args: { accountId: 'a', amount: 1, transactionType: 'expense', originalAmount: 5 } }),
    ).toThrow(/"originalAmount" and "originalCurrencyCode" must be set, or cleared, together/);
    expect(() => findTool({ name: 'bulk_delete_transactions' }).validateArgs({ args: { filters: {} } })).toThrow(
      /Refusing to delete without a narrowing filter/,
    );
  });

  it('accepts anything through validateArgs for a tool with no argument check', () => {
    expect(() => findTool({ name: 'create_category' }).validateArgs({ args: { name: 'Food' } })).not.toThrow();
    expect(() => findTool({ name: 'get_categories' }).validateArgs({ args: undefined })).not.toThrow();
  });

  it('returns the same frozen array on every call', () => {
    const first = getToolCatalog();
    const second = getToolCatalog();

    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});
