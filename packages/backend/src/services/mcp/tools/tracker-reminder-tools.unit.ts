import { TRACKER_STATUSES, TRACKER_TYPES, TAG_REMINDER_FREQUENCIES, TAG_REMINDER_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { createReminderBodySchema, updateReminderBodySchema } from '@controllers/tag-reminders/shared-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import {
  createReminder,
  deleteReminder,
  getAllReminders,
  getReminderById,
  getRemindersForTag,
  updateReminder,
} from '@services/tag-reminders';
import { getCategoryTrackerTransactions } from '@services/trackers/get-category-tracker-transactions';
import { getTrackerById } from '@services/trackers/get-trackers';
import { getTrackerStats } from '@services/trackers/stats';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. The serializers run for real on the fakes below.
jest.mock('@services/trackers/get-trackers', () => ({ getTrackerById: jest.fn(), getTrackers: jest.fn() }));
jest.mock('@services/trackers/stats', () => ({ getTrackerStats: jest.fn() }));
jest.mock('@services/trackers/get-category-tracker-transactions', () => ({
  getCategoryTrackerTransactions: jest.fn(),
}));
jest.mock('@services/tag-reminders', () => ({
  createReminder: jest.fn(),
  deleteReminder: jest.fn(),
  getAllReminders: jest.fn(),
  getReminderById: jest.fn(),
  getRemindersForTag: jest.fn(),
  updateReminder: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreateTagReminder } from './create-tag-reminder';
import { registerDeleteTagReminder } from './delete-tag-reminder';
import { registerGetTagReminders } from './get-tag-reminders';
import { registerGetTracker } from './get-tracker';
import { registerGetTrackerTransactions } from './get-tracker-transactions';
import { registerUpdateTagReminder } from './update-tag-reminder';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const trackerById = jest.mocked(getTrackerById);
const trackerStats = jest.mocked(getTrackerStats);
const categoryTransactions = jest.mocked(getCategoryTrackerTransactions);
const createRem = jest.mocked(createReminder);
const deleteRem = jest.mocked(deleteReminder);
const allRem = jest.mocked(getAllReminders);
const remById = jest.mocked(getReminderById);
const remsForTag = jest.mocked(getRemindersForTag);
const updateRem = jest.mocked(updateReminder);

const TRACKER_ID = '11111111-1111-4111-8111-111111111111';
const TAG_ID = '22222222-2222-4222-8222-222222222222';
const REMINDER_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const makeTracker = (patch: Record<string, unknown> = {}) => ({
  id: TRACKER_ID,
  userId: 42,
  name: 'Groceries',
  status: TRACKER_STATUSES.active,
  type: TRACKER_TYPES.category,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  endDate: new Date('2026-10-31T23:59:59.000Z'),
  autoInclude: false,
  limitAmount: Money.fromDecimal(500),
  categories: [{ id: CATEGORY_ID, name: 'Food', color: '#112233', parentId: null }],
  ...patch,
});

const makeStats = (patch: Record<string, number | null> = {}) => ({
  summary: {
    actualIncome: 1000,
    actualExpense: 12345,
    balance: -11345,
    utilizationRate: 24.69,
    transactionsCount: 3,
    firstTransactionDate: '2026-10-02',
    lastTransactionDate: '2026-10-20',
    ...patch,
  },
  lines: [],
  otherSpent: 0,
});

const makeReminder = (patch: Record<string, unknown> = {}) => ({
  id: REMINDER_ID,
  userId: 42,
  tagId: TAG_ID,
  type: TAG_REMINDER_TYPES.amountThreshold,
  frequency: TAG_REMINDER_FREQUENCIES.monthly,
  dayOfMonth: 15,
  settings: { amountThreshold: 500 },
  isEnabled: true,
  lastCheckedAt: null,
  lastTriggeredAt: null,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:00:00.000Z'),
  ...patch,
});

const restCreateAccepts = (patch: Record<string, unknown>) =>
  createReminderBodySchema.safeParse({ type: TAG_REMINDER_TYPES.amountThreshold, ...patch }).success;
const restUpdateAccepts = (patch: Record<string, unknown>) => updateReminderBodySchema.safeParse(patch).success;

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_tracker', () => {
  const tool = captureTools({ register: registerGetTracker })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name, takes only a tracker id and says it reads one tracker with its stats', () => {
    expect(tool.name).toBe('get_tracker');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['trackerId']);
    expect(schema.safeParse({ trackerId: TRACKER_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ trackerId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ trackerId: TRACKER_ID, userId: 7 }).success).toBe(false);
    expect(tool.config.description).toMatch(/tracker/i);
    expect(tool.config.description).toMatch(/stats|spent/i);
  });

  it('reads the tracker and its stats for the caller, as decimals, and works for a read-only user during the lock', async () => {
    lockCheck.mockResolvedValue(true);
    trackerById.mockResolvedValue(makeTracker() as never);
    trackerStats.mockResolvedValue({ stats: makeStats(), decimals: 2 } as never);

    const data = await call({ tool, args: { trackerId: TRACKER_ID }, extra: READ_ONLY });

    expect(trackerById).toHaveBeenCalledWith({ id: TRACKER_ID, userId: 42 });
    expect(trackerStats).toHaveBeenCalledWith({ userId: 42, trackerId: TRACKER_ID });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual({
      tracker: {
        id: TRACKER_ID,
        userId: 42,
        name: 'Groceries',
        status: TRACKER_STATUSES.active,
        type: TRACKER_TYPES.category,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-10-31T23:59:59.000Z',
        autoInclude: false,
        limitAmount: 500,
        lines: [],
        categories: [{ id: CATEGORY_ID, name: 'Food', color: '#112233', parentId: null }],
      },
      stats: {
        summary: {
          actualIncome: 10,
          actualExpense: 123.45,
          balance: -113.45,
          utilizationRate: 24.69,
          transactionsCount: 3,
          firstTransactionDate: '2026-10-02',
          lastTransactionDate: '2026-10-20',
        },
        lines: [],
        otherSpent: 0,
      },
    });
  });

  it('converts the minor-unit sums at the decimals the stats service reports', async () => {
    trackerById.mockResolvedValue(makeTracker() as never);
    trackerStats.mockResolvedValue({ stats: makeStats({ actualExpense: 1234 }), decimals: 3 } as never);

    const data = (await call({ tool, args: { trackerId: TRACKER_ID } })) as {
      stats: { summary: { actualExpense: number } };
    };

    expect(data.stats.summary.actualExpense).toBe(1.234);
  });

  it('includes the share context for a tracker shared with the caller', async () => {
    const share = {
      isOwner: false,
      owner: { id: 7, name: 'Owner' },
      permission: 'read',
      policy: null,
      accessSource: 'direct',
    };
    trackerById.mockResolvedValue(makeTracker({ _shareContext: share }) as never);
    trackerStats.mockResolvedValue({ stats: makeStats(), decimals: 2 } as never);

    const data = (await call({ tool, args: { trackerId: TRACKER_ID } })) as { tracker: { share?: unknown } };

    expect(data.tracker.share).toEqual(share);
  });

  it('answers not found, without reading stats, when the lookup finds no tracker for the caller', async () => {
    trackerById.mockResolvedValue(null);

    await expect(call({ tool, args: { trackerId: TRACKER_ID } })).rejects.toThrow(/budgets.budgetNotFound/);
    expect(trackerStats).not.toHaveBeenCalled();
  });

  it('lets the stats service not-found through, as for a tracker the caller has no claim on', async () => {
    trackerById.mockResolvedValue(makeTracker() as never);
    trackerStats.mockRejectedValue(new NotFoundError({ message: 'Tracker not found.' }));

    await expect(call({ tool, args: { trackerId: TRACKER_ID } })).rejects.toThrow('Tracker not found.');
  });
});

describe('get_tracker_transactions', () => {
  const tool = captureTools({ register: registerGetTrackerTransactions })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and points manual trackers to search_transactions', () => {
    expect(tool.name).toBe('get_tracker_transactions');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['from', 'limit', 'trackerId']);
    expect(tool.config.description).toMatch(/category/i);
    expect(tool.config.description).toMatch(/search_transactions/);
    expect(tool.config.description).toMatch(/trackerIds/);
  });

  it('applies the REST bounds: from 0 or more, limit 1 to 100, defaults 0 and 50', () => {
    expect(schema.parse({ trackerId: TRACKER_ID })).toMatchObject({ from: 0, limit: 50 });
    expect(schema.safeParse({ trackerId: TRACKER_ID, from: 0, limit: 1 }).success).toBe(true);
    expect(schema.safeParse({ trackerId: TRACKER_ID, from: 200, limit: 100 }).success).toBe(true);
    expect(schema.safeParse({ trackerId: TRACKER_ID, from: -1 }).success).toBe(false);
    expect(schema.safeParse({ trackerId: TRACKER_ID, from: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ trackerId: TRACKER_ID, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ trackerId: TRACKER_ID, limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ trackerId: TRACKER_ID, limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ from: 0 }).success).toBe(false);
    expect(schema.safeParse({ trackerId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ trackerId: TRACKER_ID, userId: 7 }).success).toBe(false);
  });

  it('passes the caller and the window to the service and returns its result, for a read-only user', async () => {
    lockCheck.mockResolvedValue(true);
    categoryTransactions.mockResolvedValue({
      transactions: [
        {
          id: 'tx-1',
          time: new Date('2026-10-05T10:00:00.000Z'),
          transactionType: 'expense',
          refAmount: 12.5,
          amount: 12.5,
          note: null,
          categoryId: CATEGORY_ID,
          accountId: 'acc-1',
        },
      ],
      total: 7,
    } as never);

    const data = await call({ tool, args: { trackerId: TRACKER_ID, from: 5, limit: 20 }, extra: READ_ONLY });

    expect(categoryTransactions).toHaveBeenCalledWith({ userId: 42, trackerId: TRACKER_ID, from: 5, limit: 20 });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual({
      transactions: [
        {
          id: 'tx-1',
          time: '2026-10-05T10:00:00.000Z',
          transactionType: 'expense',
          refAmount: 12.5,
          amount: 12.5,
          note: null,
          categoryId: CATEGORY_ID,
          accountId: 'acc-1',
        },
      ],
      total: 7,
    });
  });

  it('lets the service errors through: a manual tracker and a tracker the caller has no claim on', async () => {
    categoryTransactions.mockRejectedValueOnce(new ValidationError({ message: 'Not a category tracker.' }));
    await expect(call({ tool, args: { trackerId: TRACKER_ID } })).rejects.toThrow('Not a category tracker.');

    categoryTransactions.mockRejectedValueOnce(new NotFoundError({ message: 'Tracker not found.' }));
    await expect(call({ tool, args: { trackerId: TRACKER_ID } })).rejects.toThrow('Tracker not found.');
  });
});

describe('get_tag_reminders', () => {
  const tool = captureTools({ register: registerGetTagReminders })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with optional tagId and reminderId, and says reminderId needs tagId', () => {
    expect(tool.name).toBe('get_tag_reminders');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['reminderId', 'tagId']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ tagId: TAG_ID }).success).toBe(true);
    expect(schema.safeParse({ tagId: TAG_ID, reminderId: REMINDER_ID }).success).toBe(true);
    expect(schema.safeParse({ tagId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ reminderId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ userId: 7 }).success).toBe(false);
    expect(tool.config.description).toMatch(/reminderId/);
    expect(tool.config.description).toMatch(/needs tagId|requires tagId|with tagId/i);
  });

  it('lists every reminder of the caller with no arguments, and works for a read-only user during the lock', async () => {
    lockCheck.mockResolvedValue(true);
    allRem.mockResolvedValue([makeReminder()] as never);

    const data = await call({ tool, args: {}, extra: READ_ONLY });

    expect(allRem).toHaveBeenCalledWith({ userId: 42 });
    expect(remsForTag).not.toHaveBeenCalled();
    expect(remById).not.toHaveBeenCalled();
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual([
      {
        id: REMINDER_ID,
        userId: 42,
        tagId: TAG_ID,
        type: TAG_REMINDER_TYPES.amountThreshold,
        frequency: TAG_REMINDER_FREQUENCIES.monthly,
        dayOfMonth: 15,
        settings: { amountThreshold: 500 },
        isEnabled: true,
        lastCheckedAt: null,
        lastTriggeredAt: null,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
      },
    ]);
  });

  it('lists the reminders of one tag of the caller', async () => {
    remsForTag.mockResolvedValue([makeReminder(), makeReminder({ id: 'other' })] as never);

    const data = (await call({ tool, args: { tagId: TAG_ID } })) as { id: string }[];

    expect(remsForTag).toHaveBeenCalledWith({ userId: 42, tagId: TAG_ID });
    expect(allRem).not.toHaveBeenCalled();
    expect(data.map((r) => r.id)).toEqual([REMINDER_ID, 'other']);
  });

  it('reads one reminder, scoped to the caller and the tag', async () => {
    remById.mockResolvedValue(makeReminder() as never);

    const data = await call({ tool, args: { tagId: TAG_ID, reminderId: REMINDER_ID } });

    expect(remById).toHaveBeenCalledWith({ id: REMINDER_ID, userId: 42, tagId: TAG_ID });
    expect(remsForTag).not.toHaveBeenCalled();
    expect(data).toMatchObject({ id: REMINDER_ID, tagId: TAG_ID, settings: { amountThreshold: 500 } });
  });

  it('refuses a reminderId without a tagId before any service call', async () => {
    await expect(call({ tool, args: { reminderId: REMINDER_ID } })).rejects.toThrow(/tagId/);

    expect(allRem).not.toHaveBeenCalled();
    expect(remsForTag).not.toHaveBeenCalled();
    expect(remById).not.toHaveBeenCalled();
  });

  it('returns an empty list for a user without reminders and lets the not-found errors through', async () => {
    allRem.mockResolvedValue([]);
    expect(await call({ tool, args: {} })).toEqual([]);

    remsForTag.mockRejectedValueOnce(new NotFoundError({ message: 'Tag not found.' }));
    await expect(call({ tool, args: { tagId: TAG_ID } })).rejects.toThrow('Tag not found.');

    remById.mockRejectedValueOnce(new NotFoundError({ message: 'Reminder not found.' }));
    await expect(call({ tool, args: { tagId: TAG_ID, reminderId: REMINDER_ID } })).rejects.toThrow(
      'Reminder not found.',
    );
  });
});

describe('create_tag_reminder', () => {
  const tool = captureTools({ register: registerCreateTagReminder })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = { tagId: TAG_ID, type: TAG_REMINDER_TYPES.amountThreshold, amountThreshold: 500 };

  it('registers under its name and flattens the REST settings into amountThreshold', () => {
    expect(tool.name).toBe('create_tag_reminder');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['amountThreshold', 'dayOfMonth', 'frequency', 'isEnabled', 'tagId', 'type'].toSorted(),
    );
    expect(Object.keys(createReminderBodySchema.shape).toSorted()).toEqual(
      ['dayOfMonth', 'frequency', 'isEnabled', 'settings', 'type'].toSorted(),
    );
  });

  it('documents the types, real-time reminders, the threshold currency and the limit', () => {
    expect(tool.config.description).toMatch(/amount_threshold/);
    expect(tool.config.description).toMatch(/existence_check/);
    expect(tool.config.description).toMatch(/real-time/i);
    expect(tool.config.description).toMatch(/base currency/i);
    expect(tool.config.description).toMatch(/50/);
  });

  it('accepts exactly what the REST body schema accepts, field by field', () => {
    const mcp = (patch: Record<string, unknown>) => schema.safeParse({ ...base, ...patch }).success;
    const samples: [string, unknown][] = [
      ['type', TAG_REMINDER_TYPES.existenceCheck],
      ['type', 'weekly'],
      ['type', 'amountThreshold'],
      ['frequency', TAG_REMINDER_FREQUENCIES.daily],
      ['frequency', TAG_REMINDER_FREQUENCIES.yearly],
      ['frequency', null],
      ['frequency', 'hourly'],
      ['dayOfMonth', 1],
      ['dayOfMonth', 31],
      ['dayOfMonth', null],
      ['dayOfMonth', 0],
      ['dayOfMonth', 32],
      ['dayOfMonth', 1.5],
      ['isEnabled', false],
      ['isEnabled', 'yes'],
    ];

    for (const [field, value] of samples) {
      expect({ field, value, ok: mcp({ [field]: value }) }).toEqual({
        field,
        value,
        ok: restCreateAccepts({ [field]: value }),
      });
    }

    for (const value of [0.01, 500, 0.001, 0, -5, Number.NaN]) {
      expect({ value, ok: mcp({ amountThreshold: value }) }).toEqual({
        value,
        ok: restCreateAccepts({ settings: { amountThreshold: value } }),
      });
    }
  });

  it('requires a tag id and a type, and rejects a foreign user id', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ type: base.type }).success).toBe(false);
    expect(schema.safeParse({ tagId: TAG_ID }).success).toBe(false);
    expect(schema.safeParse({ ...base, tagId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...base, userId: 7 }).success).toBe(false);
  });

  it('creates a scheduled amount reminder for the caller, through the REST deserializer, and returns it', async () => {
    createRem.mockResolvedValue(makeReminder() as never);

    const data = await call({
      tool,
      args: { ...base, frequency: TAG_REMINDER_FREQUENCIES.monthly, dayOfMonth: 15, isEnabled: true },
      extra: WRITE,
    });

    expect(createRem).toHaveBeenCalledWith({
      userId: 42,
      tagId: TAG_ID,
      type: TAG_REMINDER_TYPES.amountThreshold,
      frequency: TAG_REMINDER_FREQUENCIES.monthly,
      dayOfMonth: 15,
      settings: { amountThreshold: 500 },
      isEnabled: true,
    });
    expect(data).toMatchObject({
      id: REMINDER_ID,
      tagId: TAG_ID,
      frequency: 'monthly',
      settings: { amountThreshold: 500 },
    });
  });

  it('creates a real-time reminder with a null schedule and empty settings when only the type is given', async () => {
    createRem.mockResolvedValue(makeReminder({ type: TAG_REMINDER_TYPES.existenceCheck, frequency: null }) as never);

    await call({ tool, args: { tagId: TAG_ID, type: TAG_REMINDER_TYPES.existenceCheck }, extra: WRITE });

    expect(createRem).toHaveBeenCalledWith({
      userId: 42,
      tagId: TAG_ID,
      type: TAG_REMINDER_TYPES.existenceCheck,
      frequency: null,
      dayOfMonth: null,
      settings: {},
      isEnabled: undefined,
    });
  });

  it('lets the service errors through: the missing threshold, the limit, a duplicate and a foreign tag', async () => {
    const args = { tagId: TAG_ID, type: TAG_REMINDER_TYPES.amountThreshold };

    createRem.mockRejectedValueOnce(new ValidationError({ message: 'An amount threshold is required.' }));
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow('An amount threshold is required.');
    createRem.mockRejectedValueOnce(new ValidationError({ message: 'Reminder limit reached.' }));
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow('Reminder limit reached.');
    createRem.mockRejectedValueOnce(new ConflictError({ message: 'Reminder already exists.' }));
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow('Reminder already exists.');
    createRem.mockRejectedValueOnce(new NotFoundError({ message: 'Tag not found.' }));
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow('Tag not found.');
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    await expect(call({ tool, args: base, extra: READ_ONLY })).rejects.toThrow();
    await expect(call({ tool, args: base, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    await expect(call({ tool, args: base, extra: DELETE_ONLY })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: base, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(createRem).not.toHaveBeenCalled();
  });
});

describe('update_tag_reminder', () => {
  const tool = captureTools({ register: registerUpdateTagReminder })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = { tagId: TAG_ID, reminderId: REMINDER_ID };

  it('registers under its name with both ids plus every REST update field, the settings flattened', () => {
    expect(tool.name).toBe('update_tag_reminder');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['amountThreshold', 'dayOfMonth', 'frequency', 'isEnabled', 'reminderId', 'tagId', 'type'].toSorted(),
    );
    expect(Object.keys(updateReminderBodySchema.shape).toSorted()).toEqual(
      ['dayOfMonth', 'frequency', 'isEnabled', 'settings', 'type'].toSorted(),
    );
  });

  it('documents that an omitted field stays and that null clears the schedule', () => {
    expect(tool.config.description).toMatch(/omitted/i);
    expect(tool.config.description).toMatch(/null/);
  });

  it('accepts exactly what the REST update schema accepts, field by field', () => {
    const mcp = (patch: Record<string, unknown>) => schema.safeParse({ ...base, ...patch }).success;
    const samples: [string, unknown][] = [
      ['type', TAG_REMINDER_TYPES.existenceCheck],
      ['type', 'weekly'],
      ['frequency', TAG_REMINDER_FREQUENCIES.quarterly],
      ['frequency', null],
      ['frequency', 'hourly'],
      ['dayOfMonth', 31],
      ['dayOfMonth', null],
      ['dayOfMonth', 0],
      ['isEnabled', true],
      ['isEnabled', 1],
    ];

    for (const [field, value] of samples) {
      expect({ field, value, ok: mcp({ [field]: value }) }).toEqual({
        field,
        value,
        ok: restUpdateAccepts({ [field]: value }),
      });
    }

    for (const value of [0.01, 0, -1]) {
      expect({ value, ok: mcp({ amountThreshold: value }) }).toEqual({
        value,
        ok: restUpdateAccepts({ settings: { amountThreshold: value } }),
      });
    }

    expect(mcp({})).toBe(restUpdateAccepts({}));
  });

  it('requires both ids and rejects a foreign user id', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ tagId: TAG_ID }).success).toBe(false);
    expect(schema.safeParse({ reminderId: REMINDER_ID }).success).toBe(false);
    expect(schema.safeParse({ ...base, reminderId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...base, userId: 7 }).success).toBe(false);
  });

  it('passes the ids and only the given fields, the threshold wrapped into settings', async () => {
    updateRem.mockResolvedValue(makeReminder({ settings: { amountThreshold: 750 } }) as never);

    const data = await call({ tool, args: { ...base, amountThreshold: 750, isEnabled: false }, extra: WRITE });

    expect(updateRem).toHaveBeenCalledTimes(1);
    const params = updateRem.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(params).toEqual({
      id: REMINDER_ID,
      userId: 42,
      tagId: TAG_ID,
      settings: { amountThreshold: 750 },
      isEnabled: false,
    });
    expect(
      Object.keys(params)
        .filter((key) => params[key] !== undefined)
        .toSorted(),
    ).toEqual(['id', 'isEnabled', 'settings', 'tagId', 'userId']);
    expect(data).toMatchObject({ id: REMINDER_ID, settings: { amountThreshold: 750 } });
  });

  it('passes null through to clear the schedule and leaves settings alone when no threshold is given', async () => {
    updateRem.mockResolvedValue(makeReminder({ frequency: null, dayOfMonth: null }) as never);

    await call({ tool, args: { ...base, frequency: null, dayOfMonth: null }, extra: WRITE });

    const params = updateRem.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(params).toMatchObject({ frequency: null, dayOfMonth: null });
    expect(params.settings).toBeUndefined();
  });

  it('lets the service errors through: not found, a duplicate and the missing threshold', async () => {
    updateRem.mockRejectedValueOnce(new NotFoundError({ message: 'Reminder not found.' }));
    await expect(call({ tool, args: { ...base, isEnabled: false }, extra: WRITE })).rejects.toThrow(
      'Reminder not found.',
    );
    updateRem.mockRejectedValueOnce(new ConflictError({ message: 'Reminder already exists.' }));
    await expect(call({ tool, args: { ...base, dayOfMonth: 2 }, extra: WRITE })).rejects.toThrow(
      'Reminder already exists.',
    );
    updateRem.mockRejectedValueOnce(new ValidationError({ message: 'An amount threshold is required.' }));
    await expect(
      call({ tool, args: { ...base, type: TAG_REMINDER_TYPES.amountThreshold }, extra: WRITE }),
    ).rejects.toThrow('An amount threshold is required.');
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { ...base, isEnabled: false };

    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(updateRem).not.toHaveBeenCalled();
  });
});

describe('delete_tag_reminder', () => {
  const tool = captureTools({ register: registerDeleteTagReminder })[0]!;
  const args = { tagId: TAG_ID, reminderId: REMINDER_ID };

  it('registers under its name with both ids', () => {
    expect(tool.name).toBe('delete_tag_reminder');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['reminderId', 'tagId']);
    const schema = z.object(tool.config.inputSchema ?? {}).strict();
    expect(schema.safeParse(args).success).toBe(true);
    expect(schema.safeParse({ tagId: TAG_ID }).success).toBe(false);
    expect(schema.safeParse({ ...args, tagId: 'nope' }).success).toBe(false);
    expect(tool.config.description).toMatch(/finance:delete/);
  });

  it('deletes the reminder of the caller under the tag and reports it', async () => {
    deleteRem.mockResolvedValue({ success: true });

    const data = await call({ tool, args, extra: DELETE_ONLY });

    expect(deleteRem).toHaveBeenCalledWith({ id: REMINDER_ID, userId: 42, tagId: TAG_ID });
    expect(data).toEqual({ deleted: true, reminderId: REMINDER_ID });
  });

  it('requires finance:delete, not finance:write, and refuses a read-only user and a base-currency change', async () => {
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow();
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(deleteRem).not.toHaveBeenCalled();
  });

  it('lets a not-found error through', async () => {
    deleteRem.mockRejectedValue(new NotFoundError({ message: 'Reminder not found.' }));

    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow('Reminder not found.');
  });
});
