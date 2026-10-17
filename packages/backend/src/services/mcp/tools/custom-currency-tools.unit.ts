import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as customCurrencies from '@services/currencies/custom-currencies.service';
import { z } from 'zod';

// Blocks the real services, whose import chains build queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/currencies/custom-currencies.service', () => ({
  listCustomCurrencies: jest.fn(),
  createCustomCurrency: jest.fn(),
  updateCustomCurrency: jest.fn(),
  deleteCustomCurrency: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreateCustomCurrency } from './create-custom-currency';
import { registerDeleteCustomCurrency } from './delete-custom-currency';
import { registerListCustomCurrencies } from './list-custom-currencies';
import { registerUpdateCustomCurrency } from './update-custom-currency';

type Extra = {
  authInfo: { scopes: string[]; extra: { userId: number; role: string; readOnly: boolean } };
};
type Handler = (args: unknown, extra: Extra) => Promise<{ content: { type: 'text'; text: string }[] }>;
type NoArgsHandler = (extra: Extra) => Promise<{ content: { type: 'text'; text: string }[] }>;
type CapturedTool = { name: string; inputSchema?: z.ZodRawShape; handler: Handler & NoArgsHandler };

const capture = ({ register }: { register: (server: McpServer) => void }): CapturedTool => {
  const tools: CapturedTool[] = [];
  register({
    registerTool: (name: string, config: { inputSchema?: z.ZodRawShape }, handler: Handler & NoArgsHandler) => {
      tools.push({ name, inputSchema: config.inputSchema, handler });
    },
  } as unknown as McpServer);
  if (tools.length !== 1) throw new Error('Expected the register function to add exactly one tool');
  return tools[0]!;
};

const makeExtra = ({
  scopes,
  readOnly = false,
  role = USER_ROLES.common,
}: {
  scopes: string[];
  readOnly?: boolean;
  role?: string;
}): Extra => ({
  authInfo: { scopes, extra: { userId: 42, role, readOnly } },
});

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'] });

const parsed = (result: Awaited<ReturnType<Handler>>) => JSON.parse(result.content[0]!.text) as unknown;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const service = jest.mocked(customCurrencies);

const createInput = { code: 'pts', name: 'Points', decimals: 2 };

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('list_custom_currencies', () => {
  const tool = capture({ register: registerListCustomCurrencies });

  it('returns the service result without a scope helper', async () => {
    const currencies = [{ code: 'PTS', name: 'Points', symbol: null, decimals: 2, logoUrl: null }];
    service.listCustomCurrencies.mockResolvedValueOnce(currencies as never);

    const result = await tool.handler(makeExtra({ scopes: ['finance:read'], readOnly: true }));

    expect(service.listCustomCurrencies).toHaveBeenCalledWith({ userId: 42 });
    expect(parsed(result)).toEqual(currencies);
  });
});

describe('create_custom_currency', () => {
  const tool = capture({ register: registerCreateCustomCurrency });
  const schema = z.object(tool.inputSchema!);

  it('normalizes the code and accepts a valid definition', () => {
    expect(schema.parse(createInput)).toEqual({ code: 'PTS', name: 'Points', decimals: 2 });
    expect(schema.safeParse({ ...createInput, symbol: null }).success).toBe(true);
  });

  it.each([
    { label: 'an invalid code', input: { code: 'a' } },
    { label: 'a code with a symbol character', input: { code: 'PT$' } },
    { label: 'decimals out of range', input: { decimals: 99 } },
    { label: 'fractional decimals', input: { decimals: 1.5 } },
    { label: 'a missing name', input: { name: undefined } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse({ ...createInput, ...input }).success).toBe(false);
  });

  it('calls the service with the user id and the parsed body, and returns the result', async () => {
    const created = { code: 'PTS', name: 'Points', symbol: null, decimals: 2, logoUrl: null };
    service.createCustomCurrency.mockResolvedValueOnce(created as never);

    const result = await tool.handler(createInput, WRITE);

    expect(service.createCustomCurrency).toHaveBeenCalledWith({
      userId: 42,
      code: 'PTS',
      name: 'Points',
      decimals: 2,
    });
    expect(parsed(result)).toEqual(created);
  });

  it('is refused without the write scope, for read-only and for demo users', async () => {
    await expect(tool.handler(createInput, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(createInput, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(
      tool.handler(createInput, makeExtra({ scopes: ['finance:write'], role: USER_ROLES.demo })),
    ).rejects.toThrow(/demo mode/);
    expect(service.createCustomCurrency).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler(createInput, WRITE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(service.createCustomCurrency).not.toHaveBeenCalled();
  });
});

describe('update_custom_currency', () => {
  const tool = capture({ register: registerUpdateCustomCurrency });
  const schema = z.object(tool.inputSchema!);

  it('accepts a partial update and null to clear the symbol and logo', () => {
    expect(schema.safeParse({ code: 'PTS', name: 'Loyalty points' }).success).toBe(true);
    expect(schema.safeParse({ code: 'PTS', symbol: null, logoUrl: null }).success).toBe(true);
    expect(schema.safeParse({ code: 'PTS', logoUrl: 'https://example.com/pts.png' }).success).toBe(true);
  });

  it.each([
    { label: 'a missing code', input: { code: undefined, name: 'x' } },
    { label: 'decimals out of range', input: { decimals: -1 } },
    { label: 'a non-https logo', input: { logoUrl: 'http://example.com/pts.png' } },
    { label: 'an empty name', input: { name: '' } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse({ code: 'PTS', ...input }).success).toBe(false);
  });

  it('splits the code off and passes the rest of the body to the service', async () => {
    const updated = { code: 'PTS', name: 'Loyalty points', symbol: null, decimals: 2, logoUrl: null };
    service.updateCustomCurrency.mockResolvedValueOnce(updated as never);

    const result = await tool.handler({ code: 'PTS', name: 'Loyalty points', symbol: null }, WRITE);

    expect(service.updateCustomCurrency).toHaveBeenCalledWith({
      userId: 42,
      code: 'PTS',
      name: 'Loyalty points',
      symbol: null,
    });
    expect(parsed(result)).toEqual(updated);
  });

  it('is refused without the write scope or for a read-only user', async () => {
    await expect(tool.handler({ code: 'PTS', name: 'x' }, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(
      tool.handler({ code: 'PTS', name: 'x' }, makeExtra({ scopes: ['finance:write'], readOnly: true })),
    ).rejects.toThrow(/no longer includes editing/);
    expect(service.updateCustomCurrency).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ code: 'PTS', name: 'x' }, WRITE)).rejects.toThrow(
      /currencies.baseCurrencyChangeInProgress/,
    );
    expect(service.updateCustomCurrency).not.toHaveBeenCalled();
  });
});

describe('delete_custom_currency', () => {
  const tool = capture({ register: registerDeleteCustomCurrency });
  const schema = z.object(tool.inputSchema!);

  it('rejects an invalid or missing code', () => {
    expect(schema.safeParse({ code: 'pts' }).success).toBe(true);
    expect(schema.safeParse({ code: '!' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('calls the service with the user id and the normalized code', async () => {
    service.deleteCustomCurrency.mockResolvedValueOnce(undefined);

    const result = await tool.handler({ code: 'PTS' }, DELETE);

    expect(service.deleteCustomCurrency).toHaveBeenCalledWith({ userId: 42, code: 'PTS' });
    expect(parsed(result)).toEqual({ deleted: true, code: 'PTS' });
  });

  it('needs finance:delete, not finance:write', async () => {
    await expect(tool.handler({ code: 'PTS' }, WRITE)).rejects.toThrow(/Missing required scope: finance:delete/);
    await expect(
      tool.handler({ code: 'PTS' }, makeExtra({ scopes: ['finance:delete'], readOnly: true })),
    ).rejects.toThrow(/no longer includes editing/);
    expect(service.deleteCustomCurrency).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ code: 'PTS' }, DELETE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(service.deleteCustomCurrency).not.toHaveBeenCalled();
  });
});
