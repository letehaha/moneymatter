import { Money } from '@common/types/money';
import { describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSingleRefund } from '@services/tx-refunds/create-single-refund.service';
import { getRefundsForTransactionById } from '@services/tx-refunds/get-refund-for-transaction-by-id.service';
import { z } from 'zod';

jest.mock('@services/tx-refunds/create-single-refund.service', () => ({ createSingleRefund: jest.fn() }));
jest.mock('@services/tx-refunds/get-refund-for-transaction-by-id.service', () => ({
  getRefundsForTransactionById: jest.fn(),
}));

import { registerGetRefundLinks } from './get-refund-links';
import { registerLinkRefund } from './link-refund';

const REFUND_ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';
const PURCHASE_A = '019f7e9e-b5f4-729c-9881-9544b15f4e3e';
const PURCHASE_B = '019f7e9e-b5f4-729c-9881-9544b15f4e3f';

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ text: string }> }>;

const toolOf = ({ register }: { register: (server: McpServer) => void }) => {
  let tool: { schema: z.ZodObject<z.ZodRawShape>; handler: Handler } | undefined;
  register({
    registerTool: (_name: string, config: { inputSchema: z.ZodRawShape }, handler: Handler) => {
      tool = { schema: z.object(config.inputSchema), handler };
    },
  } as unknown as McpServer);
  if (!tool) throw new Error('Tool did not register');
  return tool;
};

const extra = { authInfo: { scopes: ['finance:read', 'finance:write'], extra: { userId: 1, readOnly: false } } };

const call = async ({ tool, args }: { tool: ReturnType<typeof toolOf>; args: Record<string, unknown> }) => {
  const res = await tool.handler(tool.schema.parse(args), extra);
  return JSON.parse(res.content[0]!.text);
};

describe('MCP refund link tools', () => {
  const link = toolOf({ register: registerLinkRefund });
  const getLinks = toolOf({ register: registerGetRefundLinks });

  it('link_refund rejects a share below one cent', () => {
    const base = { originalTxId: PURCHASE_A, refundTxId: REFUND_ID };
    expect(link.schema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(link.schema.safeParse({ ...base, amount: 0.004 }).success).toBe(false);
    expect(link.schema.safeParse({ ...base, amount: -5 }).success).toBe(false);
    expect(link.schema.safeParse(base).success).toBe(true);
  });

  it('link_refund passes each share as Money and returns it, and omits it for a whole-refund link', async () => {
    jest
      .mocked(createSingleRefund)
      .mockImplementation(async (p) => ({ id: 1, splitId: null, ...p, amount: p.amount ?? null }) as never);

    const first = await call({ tool: link, args: { originalTxId: PURCHASE_A, refundTxId: REFUND_ID, amount: 30.5 } });
    const second = await call({ tool: link, args: { originalTxId: PURCHASE_B, refundTxId: REFUND_ID, amount: 19.5 } });
    const whole = await call({ tool: link, args: { originalTxId: PURCHASE_A, refundTxId: REFUND_ID } });

    const passed = jest.mocked(createSingleRefund).mock.calls.map(([p]) => p.amount);
    expect(passed[0]!.equals(Money.fromDecimal(30.5))).toBe(true);
    expect(passed[1]!.equals(Money.fromDecimal(19.5))).toBe(true);
    expect(passed[2]).toBeUndefined();

    expect(first).toMatchObject({ originalTxId: PURCHASE_A, refundTxId: REFUND_ID, amount: 30.5 });
    expect(second).toMatchObject({ originalTxId: PURCHASE_B, refundTxId: REFUND_ID, amount: 19.5 });
    expect(whole.amount).toBeNull();
  });

  it('get_refund_links returns every link with its share, null for a whole refund', async () => {
    jest.mocked(getRefundsForTransactionById).mockResolvedValueOnce([
      { refundTxId: REFUND_ID, originalTxId: PURCHASE_A, splitId: null, amount: Money.fromDecimal(30.5) },
      { refundTxId: REFUND_ID, originalTxId: PURCHASE_B, splitId: 'split-1', amount: Money.fromDecimal(19.5) },
      { refundTxId: REFUND_ID, originalTxId: null, splitId: null, amount: null },
    ] as never);

    const data = await call({ tool: getLinks, args: { transactionId: REFUND_ID } });

    expect(getRefundsForTransactionById).toHaveBeenCalledWith({ userId: 1, transactionId: REFUND_ID });
    expect(data).toEqual([
      { refundTxId: REFUND_ID, originalTxId: PURCHASE_A, splitId: null, amount: 30.5 },
      { refundTxId: REFUND_ID, originalTxId: PURCHASE_B, splitId: 'split-1', amount: 19.5 },
      { refundTxId: REFUND_ID, originalTxId: null, splitId: null, amount: null },
    ]);
  });
});
