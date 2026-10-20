import { CATEGORIZATION_MODE } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createPayee, deletePayee, deletePayeeAndIgnoreFuture } from '@services/payees';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real service, whose import chain builds queues at module scope and would open Redis
// connections in a unit test.
jest.mock('@services/payees', () => ({
  createPayee: jest.fn(),
  deletePayee: jest.fn(),
  deletePayeeAndIgnoreFuture: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreatePayee } from './create-payee';
import { registerDeletePayee } from './delete-payee';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const WRITE_DELETE = makeExtra({ scopes: ['finance:read', 'finance:write', 'finance:delete'] });

const PAYEE_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const TAG_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isBaseCurrencyChangeLocked).mockResolvedValue(false);
});

describe('create_payee', () => {
  const tool = captureTools({ register: registerCreatePayee })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts the categorization mode, the default tags and the default location like the REST body', () => {
    expect(
      schema.safeParse({
        name: 'Netflix',
        categorizationMode: CATEGORIZATION_MODE.hint,
        defaultTagIds: [TAG_ID],
        defaultLocation: { latitude: 52.5, longitude: 13.4 },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ name: 'Netflix', categorizationMode: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ name: 'Netflix', defaultTagIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ name: 'Netflix', defaultLocation: { latitude: 91, longitude: 0 } }).success).toBe(false);
  });

  it('passes them to the service and returns the payee with its settings', async () => {
    jest.mocked(createPayee).mockResolvedValue({
      id: PAYEE_ID,
      name: 'Netflix',
      defaultCategoryId: CATEGORY_ID,
      categorizationMode: CATEGORIZATION_MODE.hint,
      defaultTags: [{ id: TAG_ID }],
      defaultLocation: { latitude: 52.5, longitude: 13.4 },
    } as never);

    const data = parseToolResult({
      result: await tool.handler(
        {
          name: 'Netflix',
          defaultCategoryId: CATEGORY_ID,
          categorizationMode: CATEGORIZATION_MODE.hint,
          defaultTagIds: [TAG_ID],
          defaultLocation: { latitude: 52.5, longitude: 13.4 },
        },
        WRITE,
      ),
    });

    expect(jest.mocked(createPayee)).toHaveBeenCalledWith({
      userId: 42,
      name: 'Netflix',
      defaultCategoryId: CATEGORY_ID,
      categorizationMode: CATEGORIZATION_MODE.hint,
      defaultTagIds: [TAG_ID],
      defaultLocation: { latitude: 52.5, longitude: 13.4 },
    });
    expect(data).toMatchObject({
      id: PAYEE_ID,
      categorizationMode: CATEGORIZATION_MODE.hint,
      defaultTagIds: [TAG_ID],
      defaultLocation: { latitude: 52.5, longitude: 13.4 },
    });
  });
});

describe('delete_payee', () => {
  const tool = captureTools({ register: registerDeletePayee })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('takes an optional ignoreFuture flag', () => {
    expect(schema.safeParse({ id: PAYEE_ID, ignoreFuture: true }).success).toBe(true);
    expect(schema.safeParse({ id: PAYEE_ID, ignoreFuture: 'yes' }).success).toBe(false);
  });

  it('deletes the payee alone by default', async () => {
    const data = parseToolResult({ result: await tool.handler({ id: PAYEE_ID }, WRITE_DELETE) });

    expect(jest.mocked(deletePayee)).toHaveBeenCalledWith({ userId: 42, id: PAYEE_ID });
    expect(jest.mocked(deletePayeeAndIgnoreFuture)).not.toHaveBeenCalled();
    expect(data).toEqual({ ok: true });
  });

  it('also ignores the payee names with ignoreFuture and says how many were added', async () => {
    jest.mocked(deletePayeeAndIgnoreFuture).mockResolvedValue({ addedCount: 2 });

    const data = parseToolResult({
      result: await tool.handler({ id: PAYEE_ID, ignoreFuture: true }, WRITE_DELETE),
    });

    expect(jest.mocked(deletePayeeAndIgnoreFuture)).toHaveBeenCalledWith({ userId: 42, payeeId: PAYEE_ID });
    expect(jest.mocked(deletePayee)).not.toHaveBeenCalled();
    expect(data).toEqual({ ok: true, ignoredAddedCount: 2 });
  });
});
