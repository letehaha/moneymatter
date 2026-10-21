import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import * as userExchangeRates from '@services/user-exchange-rate';
import { z } from 'zod';

// Blocks the real service, whose import chain builds queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/user-exchange-rate', () => ({
  editUserExchangeRates: jest.fn(),
  removeUserExchangeRates: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerDeleteExchangeRates } from './delete-exchange-rates';
import { registerSetExchangeRates } from './set-exchange-rates';

type Extra = {
  authInfo: { scopes: string[]; extra: { userId: number; role: string; readOnly: boolean } };
};
type Handler = (args: unknown, extra: Extra) => Promise<{ content: { type: 'text'; text: string }[] }>;
type CapturedTool = { name: string; inputSchema?: z.ZodRawShape; handler: Handler };

const capture = ({ register }: { register: (server: McpServer) => void }): CapturedTool => {
  const tools: CapturedTool[] = [];
  register({
    registerTool: (name: string, config: { inputSchema?: z.ZodRawShape }, handler: Handler) => {
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
const ratesService = jest.mocked(userExchangeRates);

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('set_exchange_rates', () => {
  const tool = capture({ register: registerSetExchangeRates });
  const schema = z.object(tool.inputSchema!);

  const pairs = [
    { baseCode: 'EUR', quoteCode: 'USD', rate: 1.01 },
    { baseCode: 'USD', quoteCode: 'EUR', rate: 0.99 },
  ];

  it('accepts pairs of ISO codes', () => {
    expect(schema.safeParse({ pairs }).success).toBe(true);
  });

  it.each([
    { label: 'no pairs', input: { pairs: [] } },
    { label: 'a zero rate', input: { pairs: [{ baseCode: 'EUR', quoteCode: 'USD', rate: 0 }] } },
    { label: 'a negative rate', input: { pairs: [{ baseCode: 'EUR', quoteCode: 'USD', rate: -1 }] } },
    { label: 'an unknown key', input: { pairs: [{ baseCode: 'EUR', quoteCode: 'USD', rate: 1, note: 'x' }] } },
    { label: 'a missing quote', input: { pairs: [{ baseCode: 'EUR', rate: 1 }] } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('hands the pairs to editUserExchangeRates and returns its result', async () => {
    const edited = { rates: [], remeasure: { updated: 0, failed: 0 } };
    ratesService.editUserExchangeRates.mockResolvedValueOnce(edited as never);

    const result = await tool.handler({ pairs }, WRITE);

    expect(ratesService.editUserExchangeRates).toHaveBeenCalledWith({ userId: 42, pairs });
    expect(parsed(result)).toEqual(edited);
  });

  it('refuses a pair without its opposite and a pair with the same base and quote, as the REST route does', async () => {
    await expect(tool.handler({ pairs: [pairs[0]] }, WRITE)).rejects.toThrow('opposite pair');
    await expect(tool.handler({ pairs: [{ baseCode: 'USD', quoteCode: 'USD', rate: 1 }] }, WRITE)).rejects.toThrow(
      'same base and quote',
    );
    expect(ratesService.editUserExchangeRates).not.toHaveBeenCalled();
  });

  it('is refused without the write scope, for read-only users and while the lock is set', async () => {
    await expect(tool.handler({ pairs }, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler({ pairs }, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    lockCheck.mockResolvedValueOnce(true);
    await expect(tool.handler({ pairs }, WRITE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(ratesService.editUserExchangeRates).not.toHaveBeenCalled();
  });
});

describe('delete_exchange_rates', () => {
  const tool = capture({ register: registerDeleteExchangeRates });
  const schema = z.object(tool.inputSchema!);

  const pairs = [
    { baseCode: 'EUR', quoteCode: 'USD' },
    { baseCode: 'USD', quoteCode: 'EUR' },
  ];

  it('accepts pairs and rejects a pair without a quote', () => {
    expect(schema.safeParse({ pairs }).success).toBe(true);
    expect(schema.safeParse({ pairs: [{ baseCode: 'EUR' }] }).success).toBe(false);
    expect(schema.safeParse({ pairs: [] }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('hands the pairs to removeUserExchangeRates and returns its result', async () => {
    const removed = { remeasure: { updated: 1, failed: 0 } };
    ratesService.removeUserExchangeRates.mockResolvedValueOnce(removed as never);

    const result = await tool.handler({ pairs }, DELETE);

    expect(ratesService.removeUserExchangeRates).toHaveBeenCalledWith({ userId: 42, pairs });
    expect(parsed(result)).toEqual(removed);
  });

  it('refuses a pair without its opposite, as the REST route does', async () => {
    await expect(tool.handler({ pairs: [pairs[0]] }, DELETE)).rejects.toThrow('opposite pair');
    expect(ratesService.removeUserExchangeRates).not.toHaveBeenCalled();
  });

  it('needs finance:delete, not finance:write, and a user who can edit', async () => {
    await expect(tool.handler({ pairs }, WRITE)).rejects.toThrow(/Missing required scope: finance:delete/);
    await expect(tool.handler({ pairs }, makeExtra({ scopes: ['finance:delete'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    expect(ratesService.removeUserExchangeRates).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ pairs }, DELETE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(ratesService.removeUserExchangeRates).not.toHaveBeenCalled();
  });
});
