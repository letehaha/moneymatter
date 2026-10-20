import { matchingRulesSchema } from '@controllers/subscriptions/shared-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSubscription, updateSubscription } from '@services/subscriptions';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/subscriptions', () => ({ createSubscription: jest.fn(), updateSubscription: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreateSubscription } from './create-subscription';
import { registerUpdateSubscription } from './update-subscription';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const create = jest.mocked(createSubscription);
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
    register: registerCreateSubscription,
    base: { name: 'Netflix', frequency: 'monthly', startDate: '2026-01-01' },
  },
  { name: 'update_subscription', register: registerUpdateSubscription, base: { id: SUB_ID } },
])('$name', ({ name, register, base }) => {
  const tool = captureTools({ register })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name', () => {
    expect(tool.name).toBe(name);
  });

  it('declares every field of the service that REST exposes', () => {
    expect(Object.keys(tool.config.inputSchema!)).toEqual(
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

  it('describes the rule shapes for the agent', () => {
    const { description } = tool.config.inputSchema!.matchingRules as unknown as z.ZodType;
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
  const tool = captureTools({ register: registerCreateSubscription })[0]!;

  it('passes the matching rules, payee, tags, reminders and auto-record to the service', async () => {
    create.mockResolvedValue({ id: SUB_ID } as never);

    const result = parseToolResult({
      result: await tool.handler(
        {
          name: 'Netflix',
          frequency: 'monthly',
          startDate: '2026-01-01',
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

describe('update_subscription handler', () => {
  const tool = captureTools({ register: registerUpdateSubscription })[0]!;

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
