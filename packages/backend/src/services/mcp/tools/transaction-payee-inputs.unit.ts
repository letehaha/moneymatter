import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

jest.mock('@js/utils/posthog', () => ({ trackMcpToolUsed: jest.fn() }));
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/transactions/bulk-update', () => ({ bulkUpdate: jest.fn() }));

import { bulkUpdate } from '@services/transactions/bulk-update';
import { createTransaction } from '@services/transactions/create-transaction';
import { updateTransaction } from '@services/transactions/update-transaction';

import { registerBulkUpdateTransactions } from './bulk-update-transactions';
import { registerCreateTransaction } from './create-transaction';
import { registerUpdateTransaction } from './update-transaction';

const ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';
const PAYEE_ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3e';

const extra = { authInfo: { scopes: ['finance:write'], extra: { userId: 1, readOnly: false } } };

type Handler = (args: unknown, extra: unknown) => Promise<unknown>;

// Mirrors the MCP SDK: parse args with the tool's input schema, then invoke the handler.
// Services reject so the handler stops before serializing the (mocked) result.
const callTool = async ({ register, args }: { register: (server: McpServer) => void; args: object }) => {
  let shape: z.ZodRawShape | undefined;
  let handler: Handler | undefined;
  register({
    registerTool: (_name: string, config: { inputSchema: z.ZodRawShape }, cb: Handler) => {
      shape = config.inputSchema;
      handler = cb;
    },
  } as unknown as McpServer);
  if (!shape || !handler) throw new Error('Tool did not register');
  await handler(z.object(shape).parse(args), extra).catch(() => undefined);
};

describe('MCP transaction tools forward payeeId', () => {
  beforeEach(() => {
    jest.mocked(createTransaction).mockRejectedValue(new Error('stop'));
    jest.mocked(updateTransaction).mockRejectedValue(new Error('stop'));
    jest.mocked(bulkUpdate).mockRejectedValue(new Error('stop'));
  });

  it.each([PAYEE_ID, null])('update_transaction forwards payeeId=%s', async (payeeId) => {
    await callTool({ register: registerUpdateTransaction, args: { id: ID, payeeId } });
    expect(updateTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ payeeId }));
  });

  it('create_transaction forwards payeeId', async () => {
    await callTool({
      register: registerCreateTransaction,
      args: {
        accountId: ID,
        amount: 10,
        transactionType: 'expense',
        paymentType: 'cash',
        transferNature: 'not_transfer',
        payeeId: PAYEE_ID,
      },
    });
    expect(createTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ payeeId: PAYEE_ID }));
  });

  it.each([PAYEE_ID, null])('bulk_update_transactions forwards payeeId=%s', async (payeeId) => {
    await callTool({ register: registerBulkUpdateTransactions, args: { transactionIds: [ID], payeeId } });
    expect(bulkUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ payeeId }));
  });
});
