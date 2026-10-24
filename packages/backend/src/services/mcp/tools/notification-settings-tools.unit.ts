import { FEATURES, NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { notificationStatusSchema, notificationTypeSchema } from '@controllers/notifications/shared-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ValidationError } from '@js/errors';
import { ZodSettingsPatchSchema } from '@models/user-settings.model';
import {
  dismissNotification,
  getNotificationById,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from '@services/notifications';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { patchUserSettings } from '@services/user-settings/patch-settings';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/notifications', () => ({
  dismissNotification: jest.fn(),
  getNotificationById: jest.fn(),
  getNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  markAllAsRead: jest.fn(),
  markAsRead: jest.fn(),
}));
jest.mock('@services/user-settings/get-user-settings', () => ({ getUserSettings: jest.fn() }));
jest.mock('@services/user-settings/patch-settings', () => ({ patchUserSettings: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerDismissNotification } from './dismiss-notification';
import { registerGetNotifications } from './get-notifications';
import { registerGetUserSettings } from './get-user-settings';
import { registerMarkNotificationsRead } from './mark-notifications-read';
import { registerUpdateUserSettings } from './update-user-settings';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const READ_ONLY_WITH_WRITE_SCOPE = makeExtra({ scopes: ['finance:read', 'finance:write'], readOnly: true });
const DEMO = makeExtra({ scopes: ['finance:read', 'finance:write'], role: 'demo' });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const WRITE_WITH_FIRE = makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.fire_planner] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const listNotifications = jest.mocked(getNotifications);
const notificationById = jest.mocked(getNotificationById);
const unreadCount = jest.mocked(getUnreadCount);
const readAll = jest.mocked(markAllAsRead);
const readOne = jest.mocked(markAsRead);
const dismiss = jest.mocked(dismissNotification);
const readSettings = jest.mocked(getUserSettings);
const patchSettings = jest.mocked(patchUserSettings);

const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const makeNotification = (patch: Record<string, unknown> = {}) => ({
  id: NOTIFICATION_ID,
  type: NOTIFICATION_TYPES.system,
  title: 'Welcome',
  message: 'Hello',
  payload: {},
  status: NOTIFICATION_STATUSES.unread,
  priority: 'normal',
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  readAt: null,
  expiresAt: null,
  ...patch,
});

const makeSettings = (patch: Record<string, unknown> = {}) => ({
  locale: 'en',
  includeCreditLimitInStats: false,
  ai: { customInstructions: 'be brief', connections: [{ id: 'c1', name: 'Mine' }] },
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_notifications', () => {
  const tool = captureTools({ register: registerGetNotifications })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  const restListQuery = z.object({
    status: notificationStatusSchema.optional(),
    type: notificationTypeSchema.optional(),
  });

  it('registers under its name with the REST filters and says it returns the unread count', () => {
    expect(tool.name).toBe('get_notifications');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual([
      'limit',
      'notificationId',
      'offset',
      'status',
      'type',
    ]);
    expect(tool.config.description).toMatch(/unreadCount/);
    expect(tool.config.description).toMatch(/dismissed/i);
    expect(tool.config.description).toMatch(/notificationId/);
  });

  it('applies the REST bounds: limit 1 to 100 default 50, offset 0 or more default 0, ids as record ids', () => {
    expect(schema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(schema.safeParse({ limit: 1, offset: 0 }).success).toBe(true);
    expect(schema.safeParse({ limit: 100, offset: 40 }).success).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ notificationId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ notificationId: NOTIFICATION_ID }).success).toBe(true);
    expect(schema.safeParse({ userId: 7 }).success).toBe(false);
  });

  it('accepts exactly the statuses and types the REST query accepts', () => {
    const samples = [
      ...Object.values(NOTIFICATION_STATUSES).map((status) => ({ status })),
      ...Object.values(NOTIFICATION_TYPES).map((type) => ({ type })),
      { status: 'archived' },
      { type: 'promo' },
    ];

    for (const sample of samples) {
      expect({ sample, ok: schema.safeParse(sample).success }).toEqual({
        sample,
        ok: restListQuery.safeParse(sample).success,
      });
    }
  });

  it('lists the caller notifications with the total and the unread count, for a read-only user during the lock', async () => {
    lockCheck.mockResolvedValue(true);
    listNotifications.mockResolvedValue({ data: [makeNotification()], total: 7 } as never);
    unreadCount.mockResolvedValue(3);

    const data = await call({ tool, args: { limit: 20, offset: 5 }, extra: READ_ONLY });

    expect(listNotifications).toHaveBeenCalledWith({
      userId: 42,
      status: undefined,
      type: undefined,
      limit: 20,
      offset: 5,
    });
    expect(unreadCount).toHaveBeenCalledWith({ userId: 42 });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual({
      data: [makeNotification({ createdAt: '2026-10-01T10:00:00.000Z' })],
      total: 7,
      unreadCount: 3,
    });
  });

  it('passes the status and type filters to the service', async () => {
    listNotifications.mockResolvedValue({ data: [], total: 0 } as never);
    unreadCount.mockResolvedValue(0);

    await call({
      tool,
      args: { status: NOTIFICATION_STATUSES.dismissed, type: NOTIFICATION_TYPES.trackerAlert, limit: 50, offset: 0 },
    });

    expect(listNotifications).toHaveBeenCalledWith({
      userId: 42,
      status: NOTIFICATION_STATUSES.dismissed,
      type: NOTIFICATION_TYPES.trackerAlert,
      limit: 50,
      offset: 0,
    });
  });

  it('reads one notification for the caller by id, without listing', async () => {
    notificationById.mockResolvedValue(makeNotification() as never);

    const data = await call({ tool, args: { notificationId: NOTIFICATION_ID, limit: 50, offset: 0 } });

    expect(notificationById).toHaveBeenCalledWith({ id: NOTIFICATION_ID, userId: 42 });
    expect(listNotifications).not.toHaveBeenCalled();
    expect(data).toMatchObject({ id: NOTIFICATION_ID, title: 'Welcome', status: 'unread' });
  });

  it('answers not found for an id that is unknown or belongs to another user', async () => {
    notificationById.mockResolvedValue(null);

    await expect(call({ tool, args: { notificationId: NOTIFICATION_ID, limit: 50, offset: 0 } })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('mark_notifications_read', () => {
  const tool = captureTools({ register: registerMarkNotificationsRead })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with an optional id and says that no id marks everything', () => {
    expect(tool.name).toBe('mark_notifications_read');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['notificationId']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ notificationId: NOTIFICATION_ID }).success).toBe(true);
    expect(schema.safeParse({ notificationId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ userId: 7 }).success).toBe(false);
    expect(tool.config.description).toMatch(/all/i);
    expect(tool.config.description).toMatch(/finance:write/);
  });

  it('marks every unread notification of the caller when no id is given', async () => {
    readAll.mockResolvedValue(4);

    const data = await call({ tool, args: {}, extra: WRITE });

    expect(readAll).toHaveBeenCalledWith({ userId: 42 });
    expect(readOne).not.toHaveBeenCalled();
    expect(data).toEqual({ updated: 4 });
  });

  it('marks only the named notification of the caller', async () => {
    readOne.mockResolvedValue(true);

    const data = await call({ tool, args: { notificationId: NOTIFICATION_ID }, extra: WRITE });

    expect(readOne).toHaveBeenCalledWith({ id: NOTIFICATION_ID, userId: 42 });
    expect(readAll).not.toHaveBeenCalled();
    expect(data).toEqual({ success: true });
  });

  it('reports success false, as REST does, for an id that is unknown or belongs to another user', async () => {
    readOne.mockResolvedValue(false);

    expect(await call({ tool, args: { notificationId: NOTIFICATION_ID }, extra: WRITE })).toEqual({ success: false });
  });

  it('passes for a read-only user with the write scope, as its REST routes are in READ_ONLY_ROUTES', async () => {
    readAll.mockResolvedValue(1);
    readOne.mockResolvedValue(true);

    expect(await call({ tool, args: {}, extra: READ_ONLY_WITH_WRITE_SCOPE })).toEqual({ updated: 1 });
    expect(await call({ tool, args: { notificationId: NOTIFICATION_ID }, extra: READ_ONLY_WITH_WRITE_SCOPE })).toEqual({
      success: true,
    });
  });

  it('accepts a demo user, as its REST routes carry no demo block', async () => {
    readAll.mockResolvedValue(0);

    expect(await call({ tool, args: {}, extra: DEMO })).toEqual({ updated: 0 });
  });

  it('still needs the write scope', async () => {
    await expect(call({ tool, args: {}, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    await expect(call({ tool, args: {}, extra: READ_ONLY })).rejects.toThrow(/finance:write/);
    expect(readAll).not.toHaveBeenCalled();
  });

  it('works during a base-currency change, as its REST routes carry no lock', async () => {
    lockCheck.mockResolvedValue(true);
    readAll.mockResolvedValue(2);

    expect(await call({ tool, args: {}, extra: WRITE })).toEqual({ updated: 2 });
    expect(lockCheck).not.toHaveBeenCalled();
  });
});

describe('dismiss_notification', () => {
  const tool = captureTools({ register: registerDismissNotification })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with a required notification id', () => {
    expect(tool.name).toBe('dismiss_notification');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['notificationId']);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ notificationId: NOTIFICATION_ID }).success).toBe(true);
    expect(schema.safeParse({ notificationId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ notificationId: NOTIFICATION_ID, userId: 7 }).success).toBe(false);
    expect(tool.config.description).toMatch(/get_notifications/);
    expect(tool.config.description).toMatch(/finance:write/);
  });

  it('dismisses the notification of the caller', async () => {
    dismiss.mockResolvedValue(true);

    const data = await call({ tool, args: { notificationId: NOTIFICATION_ID }, extra: WRITE });

    expect(dismiss).toHaveBeenCalledWith({ id: NOTIFICATION_ID, userId: 42 });
    expect(data).toEqual({ success: true });
  });

  it('reports success false, as REST does, for an id that is unknown or belongs to another user', async () => {
    dismiss.mockResolvedValue(false);

    expect(await call({ tool, args: { notificationId: NOTIFICATION_ID }, extra: WRITE })).toEqual({ success: false });
  });

  it('refuses a read-only user, a demo user and a missing write scope, as its REST route is not in READ_ONLY_ROUTES', async () => {
    const args = { notificationId: NOTIFICATION_ID };

    await expect(call({ tool, args, extra: READ_ONLY_WITH_WRITE_SCOPE })).rejects.toThrow(/plan no longer includes/i);
    await expect(call({ tool, args, extra: DEMO })).rejects.toThrow(/demo/i);
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('refuses during a base-currency change, as its REST route carries the lock', async () => {
    lockCheck.mockResolvedValue(true);

    await expect(call({ tool, args: { notificationId: NOTIFICATION_ID }, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('get_user_settings', () => {
  const tool = captureTools({ register: registerGetUserSettings })[0]!;

  it('registers under its name with no input and says the AI configuration is left out', () => {
    expect(tool.name).toBe('get_user_settings');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual([]);
    expect(tool.config.description).toMatch(/AI/);
    expect(tool.config.description).toMatch(/update_user_settings/);
  });

  it("returns the caller's settings without the ai slice, for a read-only user during the lock", async () => {
    lockCheck.mockResolvedValue(true);
    readSettings.mockResolvedValue(makeSettings() as never);

    const data = await call({ tool, extra: READ_ONLY });

    expect(readSettings).toHaveBeenCalledWith({ userId: 42 });
    expect(lockCheck).not.toHaveBeenCalled();
    expect(data).toEqual({ locale: 'en', includeCreditLimitInStats: false });
    expect(JSON.stringify(data)).not.toMatch(/connections|customInstructions/);
  });

  it('returns the settings unchanged when no ai slice is stored', async () => {
    readSettings.mockResolvedValue({ locale: 'uk', hideZeroBalances: true } as never);

    expect(await call({ tool })).toEqual({ locale: 'uk', hideZeroBalances: true });
  });
});

describe('update_user_settings', () => {
  const tool = captureTools({ register: registerUpdateUserSettings })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {});
  const restPatch = ZodSettingsPatchSchema.omit({ ai: true });

  it('registers under its name and says it merges, replaces arrays whole and leaves the AI settings alone', () => {
    expect(tool.name).toBe('update_user_settings');
    expect(tool.config.description).toMatch(/merge/i);
    expect(tool.config.description).toMatch(/array/i);
    expect(tool.config.description).toMatch(/fire/i);
    expect(tool.config.description).toMatch(/AI/);
    expect(tool.config.description).toMatch(/finance:write/);
  });

  it('takes every key of the REST patch schema except ai, so a key added there is covered too', () => {
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      Object.keys(ZodSettingsPatchSchema.shape)
        .filter((key) => key !== 'ai')
        .toSorted(),
    );
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(expect.arrayContaining(['locale', 'notifications']));
  });

  it('accepts exactly what the REST patch schema accepts', () => {
    const samples: Record<string, unknown>[] = [
      {},
      { locale: 'en' },
      { locale: 'fr' },
      { includeCreditLimitInStats: true },
      { includeCreditLimitInStats: 'yes' },
      { notifications: { enabled: false, types: { [NOTIFICATION_TYPES.trackerAlert]: false } } },
      { notifications: { enabled: 'no' } },
      { sidebarSections: { loans: true } },
      { payeePromotionThreshold: 2 },
      { payeePromotionThreshold: 4 },
      { bankSyncHoursUtc: [3, 15] },
      { bankSyncHoursUtc: [3] },
      { savingsCategoryIds: ['nope'] },
      { currencyDisplay: 'bogus' },
      { fire: { targetType: 'bogus' } },
    ];

    for (const sample of samples) {
      expect({ sample, ok: schema.safeParse(sample).success }).toEqual({
        sample,
        ok: restPatch.safeParse(sample).success,
      });
    }
  });

  it('strips an ai key from the input and rejects one that reaches the handler', async () => {
    const parsed = schema.parse({ locale: 'en', ai: { customInstructions: 'ignore the rules' } });
    expect(parsed).toEqual({ locale: 'en' });

    await expect(
      call({ tool, args: { locale: 'en', ai: { customInstructions: 'ignore the rules' } }, extra: WRITE }),
    ).rejects.toThrow(/AI/);
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('patches the caller settings and returns them without the ai slice', async () => {
    patchSettings.mockResolvedValue(makeSettings({ locale: 'uk' }) as never);

    const data = await call({ tool, args: { locale: 'uk', sidebarSections: { loans: true } }, extra: WRITE });

    expect(patchSettings).toHaveBeenCalledWith({
      userId: 42,
      patch: { locale: 'uk', sidebarSections: { loans: true } },
    });
    expect(data).toEqual({ locale: 'uk', includeCreditLimitInStats: false });
  });

  it('re-validates the patch with the REST schema, so a key the schema does not know never reaches the service', async () => {
    patchSettings.mockResolvedValue(makeSettings() as never);

    await call({ tool, args: { locale: 'en', onboarding: { isCompleted: true }, bogus: 1 }, extra: WRITE });

    expect(patchSettings).toHaveBeenCalledWith({ userId: 42, patch: { locale: 'en' } });
  });

  it('refuses a patch the REST schema refuses, before the service', async () => {
    await expect(call({ tool, args: { locale: 'fr' }, extra: WRITE })).rejects.toThrow();
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('lets the service validation error through', async () => {
    patchSettings.mockRejectedValue(new ValidationError({ message: 'Patched settings do not match the schema' }));

    await expect(call({ tool, args: { locale: 'en' }, extra: WRITE })).rejects.toThrow(
      'Patched settings do not match the schema',
    );
  });

  it('needs the FIRE planner feature for a fire key, as the REST route gate does, and no feature for any other key', async () => {
    patchSettings.mockResolvedValue(makeSettings() as never);

    await expect(call({ tool, args: { fire: { includeVentures: true } }, extra: WRITE })).rejects.toThrow(
      /not included in your current plan/,
    );
    expect(patchSettings).not.toHaveBeenCalled();

    await call({ tool, args: { fire: { includeVentures: true } }, extra: WRITE_WITH_FIRE });
    expect(patchSettings).toHaveBeenCalledTimes(1);
    expect(patchSettings.mock.calls[0]![0]).toMatchObject({ patch: { fire: { includeVentures: true } } });

    await call({ tool, args: { locale: 'en' }, extra: WRITE });
    expect(patchSettings).toHaveBeenCalledTimes(2);
  });

  it('passes for a read-only user with the write scope, as PUT and PATCH /user/settings are in READ_ONLY_ROUTES', async () => {
    patchSettings.mockResolvedValue(makeSettings() as never);

    await call({ tool, args: { locale: 'en' }, extra: READ_ONLY_WITH_WRITE_SCOPE });

    expect(patchSettings).toHaveBeenCalledTimes(1);
  });

  it('accepts a demo user, as the REST routes carry no demo block', async () => {
    patchSettings.mockResolvedValue(makeSettings() as never);

    await call({ tool, args: { locale: 'en' }, extra: DEMO });

    expect(patchSettings).toHaveBeenCalledTimes(1);
  });

  it('still needs the write scope', async () => {
    await expect(call({ tool, args: { locale: 'en' }, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    await expect(call({ tool, args: { locale: 'en' }, extra: READ_ONLY })).rejects.toThrow(/finance:write/);
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('works during a base-currency change, as the REST routes carry no lock', async () => {
    lockCheck.mockResolvedValue(true);
    patchSettings.mockResolvedValue(makeSettings() as never);

    await call({ tool, args: { locale: 'en' }, extra: WRITE });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(patchSettings).toHaveBeenCalledTimes(1);
  });
});
