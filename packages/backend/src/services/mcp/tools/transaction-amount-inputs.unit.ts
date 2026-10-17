import { describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { captureTools } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Blocks the real services, whose import chains build queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/transactions/get-by-id', () => ({ getTransactionById: jest.fn() }));
jest.mock('@services/transactions/splits/manage-splits', () => ({ manageSplits: jest.fn() }));

import { registerCreateTransaction } from './create-transaction';
import { registerSplitTransaction } from './split-transaction';
import { registerUpdateTransaction } from './update-transaction';

const ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';

const inputSchemaOf = ({ register }: { register: (server: McpServer) => void }) => {
  const shape = captureTools({ register })[0]?.config.inputSchema;
  if (!shape) throw new Error('Tool did not register an input schema');
  return z.object(shape);
};

const createInput = {
  accountId: ID,
  amount: 10,
  transactionType: 'expense',
  paymentType: 'cash',
  transferNature: 'not_transfer',
};

describe('MCP transaction tools amount validation', () => {
  const create = inputSchemaOf({ register: registerCreateTransaction });
  const update = inputSchemaOf({ register: registerUpdateTransaction });
  const split = inputSchemaOf({ register: registerSplitTransaction });

  it('create_transaction accepts an unsigned amount', () => {
    expect(create.safeParse(createInput).success).toBe(true);
    expect(create.safeParse({ ...createInput, amount: 0 }).success).toBe(true);
  });

  it.each([
    { label: 'negative amount', input: { amount: -104243 } },
    { label: 'negative destinationAmount', input: { destinationAmount: -5 } },
    { label: 'zero destinationAmount', input: { destinationAmount: 0 } },
    { label: 'negative split amount', input: { splits: [{ categoryId: ID, amount: -5 }] } },
    { label: 'zero split amount', input: { splits: [{ categoryId: ID, amount: 0 }] } },
  ])('create_transaction rejects a $label', ({ input }) => {
    expect(create.safeParse({ ...createInput, ...input }).success).toBe(false);
  });

  it('update_transaction accepts an unsigned amount', () => {
    expect(update.safeParse({ id: ID, amount: 10 }).success).toBe(true);
    expect(update.safeParse({ id: ID, amount: 0 }).success).toBe(true);
  });

  it.each([
    { label: 'negative amount', input: { amount: -10 } },
    { label: 'negative destinationAmount', input: { destinationAmount: -5 } },
    { label: 'zero destinationAmount', input: { destinationAmount: 0 } },
    { label: 'negative split amount', input: { splits: [{ categoryId: ID, amount: -5 }] } },
    { label: 'zero split amount', input: { splits: [{ categoryId: ID, amount: 0 }] } },
  ])('update_transaction rejects a $label', ({ input }) => {
    expect(update.safeParse({ id: ID, ...input }).success).toBe(false);
  });

  it('split_transaction rejects a non-positive split amount', () => {
    expect(split.safeParse({ transactionId: ID, splits: [{ categoryId: ID, amount: 5 }] }).success).toBe(true);
    expect(split.safeParse({ transactionId: ID, splits: [{ categoryId: ID, amount: -5 }] }).success).toBe(false);
    expect(split.safeParse({ transactionId: ID, splits: [{ categoryId: ID, amount: 0 }] }).success).toBe(false);
  });
});
