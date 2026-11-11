import { matchingRulesSchema } from '@controllers/subscriptions/shared-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSubscription, getSubscriptions, updateSubscription } from '@services/subscriptions';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/subscriptions', () => ({
  createSubscription: jest.fn(),
  getSubscriptions: jest.fn(),
  updateSubscription: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { createSubscriptionTool } from './create-subscription';
import { getSubscriptionsTool } from './get-subscriptions';
import { updateSubscriptionTool } from './update-subscription';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const create = jest.mocked(createSubscription);
const list = jest.mocked(getSubscriptions);
const update = jest.mocked(updateSubscription);

const SUB_ID = '11111111-1111-4111-8111-111111111111';
const PAYEE_ID = '22222222-2222-4222-8222-222222222222';
const TAG_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

const RULES = {
  rules: [
    { field: 'note', operator: 'contains_any', value: ['netflix', 'nflx'] },
    { field: 'amount', operator: 'between', value: { min: 9, max: 11 }, currencyCode: 'USD' },
    { field: 'transactionType', operator: 'equals', value: 'expense' },
    { field: 'accountId', operator: 'equals', value: ACCOUNT_ID },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe.each([
  {
    name: 'create_subscription',
    register: createSubscriptionTool,
    base: { name: 'Netflix', frequency: 'monthly', startDate: '2026-01-01' },
  },
  { name: 'update_subscription', register: updateSubscriptionTool, base: { id: SUB_ID } },
])('$name', ({ name, register, base }) => {
  const tool = captureTools({ register })[0]!;
  const schema = tool.config.inputSchema!;

  it('registers under its name', () => {
    expect(tool.name).toBe(name);
  });

  it('declares every field of the service that REST exposes', () => {
    expect(Object.keys(tool.config.inputSchema!.shape)).toEqual(
      expect.arrayContaining(['matchingRules', 'payeeId', 'tagIds', 'remindBefore', 'notifyEmail', 'autoRecord']),
    );
  });

  it('accepts the four matching rule shapes and an empty list', () => {
    expect(schema.safeParse({ ...base, matchingRules: RULES }).success).toBe(true);
    expect(schema.safeParse({ ...base, matchingRules: { rules: [] } }).success).toBe(true);
  });

  it('rejects malformed matching rules like the REST schema does', () => {
    for (const rules of [
      [{ field: 'note', operator: 'contains_any', value: [] }],
      [{ field: 'note', operator: 'contains_any', value: [''] }],
      [{ field: 'note', operator: 'equals', value: ['x'] }],
      [{ field: 'amount', operator: 'between', value: { min: -1, max: 2 } }],
      [{ field: 'amount', operator: 'between', value: { min: 1 } }],
      [{ field: 'accountId', operator: 'equals', value: 'not-a-uuid' }],
      [{ field: 'merchant', operator: 'contains_any', value: ['x'] }],
    ]) {
      expect(matchingRulesSchema.safeParse({ rules }).success).toBe(false);
      expect(schema.safeParse({ ...base, matchingRules: { rules } }).success).toBe(false);
    }
  });

  it('validates the reminder presets and the id fields', () => {
    expect(schema.safeParse({ ...base, remindBefore: ['0_days', '1_week'], notifyEmail: true }).success).toBe(true);
    expect(schema.safeParse({ ...base, remindBefore: ['2_years'] }).success).toBe(false);
    expect(schema.safeParse({ ...base, remindBefore: ['1_day', '2_days', '3_days', '5_days'] }).success).toBe(false);
    expect(schema.safeParse({ ...base, payeeId: PAYEE_ID, tagIds: [TAG_ID] }).success).toBe(true);
    expect(schema.safeParse({ ...base, payeeId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...base, tagIds: ['nope'] }).success).toBe(false);
  });

  it('accepts a custom step and rejects an unknown unit or a fractional count', () => {
    const custom = { ...base, frequency: 'custom', intervalUnit: 'day', intervalCount: 30 };
    expect(schema.safeParse(custom).success).toBe(true);
    expect(schema.safeParse({ ...custom, intervalUnit: 'hour' }).success).toBe(false);
    expect(schema.safeParse({ ...custom, intervalCount: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ...custom, intervalCount: 0 }).success).toBe(false);
  });

  it('describes the custom frequency and its step for the agent', () => {
    const shape = tool.config.inputSchema!.shape as unknown as Record<string, z.ZodType>;
    expect(shape.frequency!.description).toContain('custom');
    expect(shape.intervalUnit!.description).toContain('day');
    expect(shape.intervalCount!.description).toBeTruthy();
  });

  it('describes the rule shapes for the agent', () => {
    const { description } = tool.config.inputSchema!.shape.matchingRules as unknown as z.ZodType;
    expect(description).toContain('contains_any');
    expect(description).toContain('between');
  });

  it('throws without the write scope, with the service not called', async () => {
    await expect(tool.handler({ ...base, matchingRules: RULES }, NO_WRITE_SCOPE)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('create_subscription handler', () => {
  const tool = captureTools({ register: createSubscriptionTool })[0]!;

  it('passes the matching rules, payee, tags, reminders and auto-record to the service', async () => {
    create.mockResolvedValue({ id: SUB_ID } as never);

    const result = parseToolResult({
      result: await tool.handler(
        {
          name: 'Netflix',
          frequency: 'monthly',
          startDate: '2026-01-01',
          expectedAmount: 9.99,
          expectedCurrencyCode: 'USD',
          matchingRules: RULES,
          payeeId: PAYEE_ID,
          tagIds: [TAG_ID],
          remindBefore: ['3_days'],
          notifyEmail: true,
          autoRecord: false,
        },
        WRITE,
      ),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        matchingRules: RULES,
        payeeId: PAYEE_ID,
        tagIds: [TAG_ID],
        remindBefore: ['3_days'],
        notifyEmail: true,
        autoRecord: false,
      }),
    );
    expect(result).toEqual({ id: SUB_ID });
  });
});

describe('create_subscription REST validation', () => {
  const tool = captureTools({ register: createSubscriptionTool })[0]!;
  const schema = tool.config.inputSchema!;
  const noAmount = { name: 'Netflix', frequency: 'monthly', startDate: '2026-01-01' };
  const base = { ...noAmount, expectedAmount: 9.99, expectedCurrencyCode: 'USD' };

  it('passes a custom step to the service', async () => {
    create.mockResolvedValue({ id: SUB_ID } as never);

    await tool.handler({ ...base, frequency: 'custom', intervalUnit: 'day', intervalCount: 30 }, WRITE);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, frequency: 'custom', intervalUnit: 'day', intervalCount: 30 }),
    );
  });

  it('refuses custom without a step with the REST message, with the service not called', async () => {
    // Unit tests run without the i18n resources, so the message is its key.
    await expect(tool.handler({ ...base, frequency: 'custom' }, WRITE)).rejects.toThrow(
      'subscriptions.validation.customInterval.required',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects the field values the REST body rejects', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(schema.safeParse({ ...base, name: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ ...base, startDate: 'next monday' }).success).toBe(false);
    expect(schema.safeParse({ ...base, dueDate: '2026-02-30' }).success).toBe(false);
    expect(schema.safeParse({ ...base, notes: 'x'.repeat(5001) }).success).toBe(false);
    expect(schema.safeParse({ ...base, expectedAmount: -1 }).success).toBe(false);
  });

  it('refuses the combinations the REST body refuses, with the service not called', async () => {
    for (const args of [
      noAmount,
      { ...noAmount, type: 'bill', expectedAmount: 10 },
      { ...base, type: 'installment', dueDate: '2026-02-01' },
      { ...base, type: 'installment', maxOccurrences: 12 },
      { ...base, endDate: '2025-12-31' },
      { ...base, autoRecord: true },
      { ...base, autoRecord: true, accountId: ACCOUNT_ID, matchingRules: RULES },
      { ...base, frequency: 'custom', intervalUnit: 'day' },
      { ...base, intervalUnit: 'day', intervalCount: 30 },
      { ...base, frequency: 'custom', intervalUnit: 'day', intervalCount: 367 },
      { ...base, frequency: 'custom', intervalUnit: 'year', intervalCount: 11 },
    ]) {
      await expect(tool.handler(args, WRITE)).rejects.toThrow();
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a bill without an amount and an installment with its count and schedule', async () => {
    create.mockResolvedValue({ id: SUB_ID } as never);

    await tool.handler({ ...noAmount, type: 'bill' }, WRITE);
    await tool.handler({ ...base, type: 'installment', maxOccurrences: 12, dueDate: '2026-02-01' }, WRITE);

    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('update_subscription REST validation', () => {
  const tool = captureTools({ register: updateSubscriptionTool })[0]!;

  it('refuses the combinations the REST body refuses, with the service not called', async () => {
    for (const args of [
      { id: SUB_ID, name: '' },
      { id: SUB_ID, startDate: '2026-13-01' },
      { id: SUB_ID, startDate: '2026-03-01', endDate: '2026-02-01' },
      { id: SUB_ID, expectedAmount: 10, expectedCurrencyCode: null },
      { id: SUB_ID, type: 'installment', maxOccurrences: 12 },
      { id: SUB_ID, autoRecord: true, accountId: null },
      { id: SUB_ID, frequency: 'monthly', intervalUnit: 'day', intervalCount: 30 },
      { id: SUB_ID, intervalUnit: 'year', intervalCount: 11 },
    ]) {
      await expect(tool.handler(args, WRITE)).rejects.toThrow();
    }
    expect(update).not.toHaveBeenCalled();
  });
});

describe('update_subscription handler', () => {
  const tool = captureTools({ register: updateSubscriptionTool })[0]!;

  it('passes only the fields that were sent, matching rules included', async () => {
    update.mockResolvedValue({ id: SUB_ID } as never);

    await tool.handler({ id: SUB_ID, matchingRules: { rules: [] }, payeeId: null, tagIds: [] }, WRITE);

    expect(update).toHaveBeenCalledWith({
      id: SUB_ID,
      userId: 42,
      matchingRules: { rules: [] },
      payeeId: null,
      tagIds: [],
    });
  });
});

describe('update_subscription custom step', () => {
  const tool = captureTools({ register: updateSubscriptionTool })[0]!;

  it('passes only the count when that is all that changed', async () => {
    update.mockResolvedValue({ id: SUB_ID } as never);

    await tool.handler({ id: SUB_ID, intervalCount: 28 }, WRITE);

    expect(update).toHaveBeenCalledWith({ id: SUB_ID, userId: 42, intervalCount: 28 });
  });
});

describe('get_subscriptions', () => {
  const tool = captureTools({ register: getSubscriptionsTool })[0]!;

  it('returns the custom step of each subscription', async () => {
    list.mockResolvedValue([
      { id: SUB_ID, name: 'Magti', frequency: 'custom', intervalUnit: 'day', intervalCount: 30 },
      { id: PAYEE_ID, name: 'Netflix', frequency: 'monthly', intervalUnit: null, intervalCount: null },
    ] as never);

    const result = parseToolResult({ result: await tool.handler({}, makeExtra({ scopes: ['finance:read'] })) });

    expect(result).toEqual([
      expect.objectContaining({ id: SUB_ID, frequency: 'custom', intervalUnit: 'day', intervalCount: 30 }),
      expect.objectContaining({ id: PAYEE_ID, frequency: 'monthly', intervalUnit: null, intervalCount: null }),
    ]);
  });
});
