import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError } from '@js/errors';
import { getConnectionDetails } from '@services/bank-data-providers/connection/get-connection-details';
import { listUserConnections } from '@services/bank-data-providers/connection/list-user-connections';
import {
  getActiveJobsForUser,
  getJobGroupProgress,
} from '@services/bank-data-providers/monobank/transaction-sync-queue';
import { getUserAccountsSyncStatus } from '@services/bank-data-providers/sync/get-user-sync-status';
import { listReceivedInvitations, listSentInvitations } from '@services/sharing/invitations/list-invitations.service';
import { listMembers } from '@services/sharing/members/list-members.service';
import { listSharedWithMe } from '@services/sharing/members/list-shared-with-me.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/sharing/invitations/list-invitations.service', () => ({
  listSentInvitations: jest.fn(),
  listReceivedInvitations: jest.fn(),
}));
jest.mock('@services/sharing/members/list-members.service', () => ({ listMembers: jest.fn() }));
jest.mock('@services/sharing/members/list-shared-with-me.service', () => ({ listSharedWithMe: jest.fn() }));
jest.mock('@services/bank-data-providers/connection/list-user-connections', () => ({ listUserConnections: jest.fn() }));
jest.mock('@services/bank-data-providers/connection/get-connection-details', () => ({
  getConnectionDetails: jest.fn(),
}));
jest.mock('@services/bank-data-providers/sync/get-user-sync-status', () => ({ getUserAccountsSyncStatus: jest.fn() }));
jest.mock('@services/bank-data-providers/monobank/transaction-sync-queue', () => ({
  getActiveJobsForUser: jest.fn(),
  getJobGroupProgress: jest.fn(),
}));

import { registerGetBankSyncStatus } from './get-bank-sync-status';
import { registerListBankConnections } from './list-bank-connections';
import { registerListShareInvitations } from './list-share-invitations';
import { registerListShareMembers } from './list-share-members';
import { registerListSharedWithMe } from './list-shared-with-me';

// Reads need only finance:read: a read-only plan and no write scope must not limit any of them.
const READER = makeExtra({ scopes: ['finance:read'], readOnly: true });
const DEMO_READER = makeExtra({ scopes: ['finance:read'], readOnly: true, role: USER_ROLES.demo });

const sentService = jest.mocked(listSentInvitations);
const receivedService = jest.mocked(listReceivedInvitations);
const membersService = jest.mocked(listMembers);
const sharedWithMeService = jest.mocked(listSharedWithMe);
const connectionsService = jest.mocked(listUserConnections);
const connectionDetailsService = jest.mocked(getConnectionDetails);
const syncStatusService = jest.mocked(getUserAccountsSyncStatus);
const activeJobsService = jest.mocked(getActiveJobsForUser);
const jobProgressService = jest.mocked(getJobGroupProgress);

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';
const INVITATION_ID = '33333333-3333-4333-8333-333333333333';
const SECRET_TOKEN = 'invite-token-do-not-leak';

const call = async ({
  tool,
  args,
  extra = READER,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const rawText = async ({ tool, args }: { tool: ReturnType<typeof captureTools>[number]; args?: unknown }) =>
  JSON.stringify(await call({ tool, args }));

/** An invitation as the service returns it: with the accept-link token and the row's bookkeeping. */
const makeInvitation = (patch: Record<string, unknown> = {}) => ({
  id: INVITATION_ID,
  ownerUserId: 42,
  inviteeEmail: 'friend@example.com',
  inviteeUserId: 7,
  resourceType: 'account',
  resourceId: ACCOUNT_ID,
  resourceName: 'Joint account',
  permission: 'edit',
  policy: null,
  token: SECRET_TOKEN,
  status: 'pending',
  expiresAt: new Date('2026-11-01T00:00:00.000Z'),
  acceptedAt: null,
  declinedAt: null,
  revokedAt: null,
  resendCount: 2,
  recentResendsAt: ['2026-10-17T08:00:00.000Z'],
  createdAt: new Date('2026-10-10T08:00:00.000Z'),
  updatedAt: new Date('2026-10-17T08:00:00.000Z'),
  emailConfigured: true,
  owner: { id: 42, username: 'nikita', avatar: 'https://cdn.example.com/a.png' },
  invitee: { id: 7, username: 'friend', avatar: null },
  ...patch,
});

/** What an assistant sees of that invitation. */
const presentedInvitation = (patch: Record<string, unknown> = {}) => ({
  id: INVITATION_ID,
  direction: 'sent',
  resourceType: 'account',
  resourceId: ACCOUNT_ID,
  resourceName: 'Joint account',
  permission: 'edit',
  policy: null,
  status: 'pending',
  inviteeEmail: 'friend@example.com',
  owner: { id: 42, username: 'nikita' },
  invitee: { id: 7, username: 'friend' },
  expiresAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-10T08:00:00.000Z',
  acceptedAt: null,
  declinedAt: null,
  revokedAt: null,
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('list_share_invitations', () => {
  const tool = captureTools({ register: registerListShareInvitations })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and bounds direction and limit', () => {
    expect(tool.name).toBe('list_share_invitations');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['direction', 'limit']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ direction: 'sent', limit: 200 }).success).toBe(true);
    expect(schema.safeParse({ direction: 'received' }).success).toBe(true);
    expect(schema.safeParse({ direction: 'both' }).success).toBe(true);
    expect(schema.safeParse({ direction: 'all' }).success).toBe(false);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
    expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it('defaults to both directions, scoped to the caller, newest first and tagged with its direction', async () => {
    sentService.mockResolvedValue([
      makeInvitation({ id: 'sent-old', createdAt: new Date('2026-10-01T00:00:00.000Z') }),
      makeInvitation({ id: 'sent-new', createdAt: new Date('2026-10-12T00:00:00.000Z') }),
    ] as never);
    receivedService.mockResolvedValue([
      makeInvitation({ id: 'received-mid', createdAt: new Date('2026-10-05T00:00:00.000Z') }),
    ] as never);

    const data = (await call({ tool, args: {} })) as {
      invitations: { id: string; direction: string }[];
      total: number;
    };

    expect(sentService).toHaveBeenCalledWith({ ownerUserId: 42 });
    expect(receivedService).toHaveBeenCalledWith({ inviteeUserId: 42 });
    expect(data.total).toBe(3);
    expect(data.invitations.map((invitation) => [invitation.id, invitation.direction])).toEqual([
      ['sent-new', 'sent'],
      ['received-mid', 'received'],
      ['sent-old', 'sent'],
    ]);
  });

  it('never returns the accept-link token, the avatars or the resend bookkeeping', async () => {
    sentService.mockResolvedValue([makeInvitation()] as never);
    receivedService.mockResolvedValue([makeInvitation({ id: 'received-1' })] as never);

    const text = await rawText({ tool, args: {} });

    expect(text).not.toContain(SECRET_TOKEN);
    expect(text).not.toMatch(/token|avatar|emailConfigured|resendCount|recentResendsAt|ownerUserId|updatedAt/);
  });

  it('reads only the sent invitations, with the invitee email the owner typed', async () => {
    sentService.mockResolvedValue([makeInvitation()] as never);

    const data = await call({ tool, args: { direction: 'sent' } });

    expect(receivedService).not.toHaveBeenCalled();
    expect(data).toEqual({ invitations: [presentedInvitation()], total: 1 });
  });

  it('reads only the received invitations, without the caller email', async () => {
    receivedService.mockResolvedValue([makeInvitation()] as never);

    const data = await call({ tool, args: { direction: 'received' } });

    expect(sentService).not.toHaveBeenCalled();
    const expected = presentedInvitation({ direction: 'received' });
    delete (expected as Record<string, unknown>).inviteeEmail;
    expect(data).toEqual({ invitations: [expected], total: 1 });
  });

  it('keeps an invitation sent to an unregistered email without an invitee user', async () => {
    sentService.mockResolvedValue([makeInvitation({ inviteeUserId: null, invitee: null })] as never);

    const data = await call({ tool, args: { direction: 'sent' } });

    expect(data).toEqual({ invitations: [presentedInvitation({ invitee: null })], total: 1 });
  });

  it('caps the list at limit and still reports the full total', async () => {
    sentService.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) =>
        makeInvitation({ id: `sent-${index}`, createdAt: new Date(`2026-10-0${index + 1}T00:00:00.000Z`) }),
      ) as never,
    );
    receivedService.mockResolvedValue([] as never);

    const data = (await call({ tool, args: { limit: 2 } })) as { invitations: { id: string }[]; total: number };

    expect(data.total).toBe(5);
    expect(data.invitations.map((invitation) => invitation.id)).toEqual(['sent-4', 'sent-3']);
  });

  it('applies a default limit of 50', async () => {
    sentService.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => makeInvitation({ id: `sent-${index}` })) as never,
    );
    receivedService.mockResolvedValue([] as never);

    const data = (await call({ tool, args: {} })) as { invitations: unknown[]; total: number };

    expect(data.invitations).toHaveLength(50);
    expect(data.total).toBe(60);
  });
});

describe('list_share_members', () => {
  const tool = captureTools({ register: registerListShareMembers })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  const makeMembers = () => ({
    resourceType: 'account',
    resourceId: ACCOUNT_ID,
    resourceName: 'Joint account',
    members: [
      {
        user: { id: 42, username: 'nikita', avatar: 'https://cdn.example.com/a.png' },
        role: 'owner',
        permission: 'manage',
        policy: null,
        acceptedAt: null,
        shareId: null,
      },
      {
        user: { id: 7, username: 'friend', avatar: null },
        role: 'recipient',
        permission: 'edit',
        policy: null,
        acceptedAt: new Date('2026-10-11T08:00:00.000Z'),
        shareId: INVITATION_ID,
      },
    ],
  });

  it('registers under its name and takes a shareable resource type and id', () => {
    expect(tool.name).toBe('list_share_members');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['resourceType', 'resourceId']);
    expect(schema.safeParse({ resourceType: 'account', resourceId: ACCOUNT_ID }).success).toBe(true);
    expect(schema.safeParse({ resourceType: 'household', resourceId: '9' }).success).toBe(true);
    expect(schema.safeParse({ resourceType: 'budget', resourceId: '9' }).success).toBe(true);
    expect(schema.safeParse({ resourceType: 'loan', resourceId: '9' }).success).toBe(false);
    expect(schema.safeParse({ resourceType: 'account' }).success).toBe(false);
    expect(schema.safeParse({ resourceType: 'account', resourceId: '' }).success).toBe(false);
  });

  it('lists the members of a resource the caller manages, without avatars or share ids', async () => {
    membersService.mockResolvedValue(makeMembers() as never);

    const data = await call({ tool, args: { resourceType: 'account', resourceId: ACCOUNT_ID } });

    expect(membersService).toHaveBeenCalledWith({ userId: 42, resourceType: 'account', resourceId: ACCOUNT_ID });
    expect(data).toEqual({
      resourceType: 'account',
      resourceId: ACCOUNT_ID,
      resourceName: 'Joint account',
      members: [
        { user: { id: 42, username: 'nikita' }, role: 'owner', permission: 'manage', policy: null, acceptedAt: null },
        {
          user: { id: 7, username: 'friend' },
          role: 'recipient',
          permission: 'edit',
          policy: null,
          acceptedAt: '2026-10-11T08:00:00.000Z',
        },
      ],
    });
  });

  it('refuses a resource the caller does not manage, as REST does with a 404 that hides it', async () => {
    membersService.mockRejectedValue(new NotFoundError({ message: 'Shared resource not found' }));

    await expect(tool.handler({ resourceType: 'account', resourceId: ACCOUNT_ID }, READER)).rejects.toThrow(
      'Shared resource not found',
    );
    expect(membersService).toHaveBeenCalledWith({ userId: 42, resourceType: 'account', resourceId: ACCOUNT_ID });
  });
});

describe('list_shared_with_me', () => {
  const tool = captureTools({ register: registerListSharedWithMe })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  const makeShare = (patch: Record<string, unknown> = {}) => ({
    shareId: INVITATION_ID,
    resourceType: 'account',
    resourceId: ACCOUNT_ID,
    resourceName: 'Joint account',
    permission: 'view',
    policy: null,
    acceptedAt: new Date('2026-10-11T08:00:00.000Z'),
    owner: { id: 9, username: 'owner', avatar: 'https://cdn.example.com/o.png' },
    accessSource: 'share',
    ...patch,
  });

  it('registers under its name and bounds limit', () => {
    expect(tool.name).toBe('list_shared_with_me');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['limit']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ limit: 200 }).success).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('lists what others shared with the caller, slimmed, scoped to the caller', async () => {
    sharedWithMeService.mockResolvedValue([
      makeShare(),
      makeShare({ resourceName: null, accessSource: 'household' }),
    ] as never);

    const data = await call({ tool, args: {} });

    expect(sharedWithMeService).toHaveBeenCalledWith({ userId: 42 });
    const slim = {
      resourceType: 'account',
      resourceId: ACCOUNT_ID,
      resourceName: 'Joint account',
      permission: 'view',
      policy: null,
      acceptedAt: '2026-10-11T08:00:00.000Z',
      owner: { id: 9, username: 'owner' },
      accessSource: 'share',
    };
    expect(data).toEqual({
      shares: [slim, { ...slim, resourceName: null, accessSource: 'household' }],
      total: 2,
    });
  });

  it('defaults the limit to 50 and caps the list at limit with the full total', async () => {
    sharedWithMeService.mockResolvedValue(Array.from({ length: 60 }, () => makeShare()) as never);

    const defaulted = (await call({ tool, args: {} })) as { shares: unknown[]; total: number };
    const capped = (await call({ tool, args: { limit: 3 } })) as { shares: unknown[]; total: number };

    expect(defaulted.shares).toHaveLength(50);
    expect(defaulted.total).toBe(60);
    expect(capped.shares).toHaveLength(3);
    expect(capped.total).toBe(60);
  });
});

describe('list_bank_connections', () => {
  const tool = captureTools({ register: registerListBankConnections })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  /** A list row plus the fields no service returns today but a future change might: they must not leak. */
  const makeConnection = (patch: Record<string, unknown> = {}) => ({
    id: CONNECTION_ID,
    providerType: 'monobank',
    providerName: 'Monobank',
    isActive: true,
    lastSyncAt: new Date('2026-10-17T08:00:00.000Z'),
    accountsCount: 2,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    bankName: 'Mono',
    apiToken: 'bank-secret-token',
    credentials: { token: 'bank-secret-token' },
    metadata: { consentId: 'consent-secret' },
    ...patch,
  });

  const makeDetails = () => ({
    id: CONNECTION_ID,
    providerType: 'enablebanking',
    providerName: 'Some Bank',
    isActive: true,
    lastSyncAt: '2026-10-17T08:00:00.000Z',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-10-17T08:00:00.000Z',
    provider: {
      name: 'Enable Banking',
      description: 'Long marketing description',
      logoUrl: 'https://cdn.example.com/logo.png',
      documentationUrl: 'https://docs.example.com',
      features: {
        supportsWebhooks: false,
        supportsRealtime: false,
        requiresReauth: true,
        supportsManualSync: true,
        supportsAutoSync: true,
        defaultSyncInterval: 3600,
        minSyncInterval: 600,
      },
    },
    accounts: [
      {
        id: ACCOUNT_ID,
        name: 'Main',
        externalId: 'PL61109010140000071219812874',
        currentBalance: 1234.56,
        currencyCode: 'EUR',
        type: 'system',
        currencyFallback: null,
      },
    ],
    consent: {
      validFrom: '2026-09-01',
      validUntil: '2026-12-01',
      daysRemaining: 44,
      isExpired: false,
      isExpiringSoon: false,
    },
    deactivationReason: null,
    sessionId: 'provider-session-secret',
    consentToken: 'consent-secret',
  });

  it('registers under its name and takes an optional connection id and a bounded limit', () => {
    expect(tool.name).toBe('list_bank_connections');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['connectionId', 'limit']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ connectionId: CONNECTION_ID, limit: 200 }).success).toBe(true);
    expect(schema.safeParse({ connectionId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('lists the connections of the caller by whitelist, so no credential or consent field can pass', async () => {
    connectionsService.mockResolvedValue([
      makeConnection(),
      makeConnection({ id: 'second', isActive: false }),
    ] as never);

    const result = await call({ tool, args: {} });
    const text = JSON.stringify(result);

    expect(connectionsService).toHaveBeenCalledWith({ userId: 42 });
    expect(connectionDetailsService).not.toHaveBeenCalled();
    expect(text).not.toMatch(/secret|apiToken|credentials|metadata/);
    expect(result).toEqual({
      connections: [
        {
          id: CONNECTION_ID,
          providerType: 'monobank',
          providerName: 'Monobank',
          bankName: 'Mono',
          isActive: true,
          lastSyncAt: '2026-10-17T08:00:00.000Z',
          accountsCount: 2,
          createdAt: '2026-09-01T08:00:00.000Z',
        },
        {
          id: 'second',
          providerType: 'monobank',
          providerName: 'Monobank',
          bankName: 'Mono',
          isActive: false,
          lastSyncAt: '2026-10-17T08:00:00.000Z',
          accountsCount: 2,
          createdAt: '2026-09-01T08:00:00.000Z',
        },
      ],
      total: 2,
    });
  });

  it('caps the list at limit with a default of 50 and reports the full total', async () => {
    connectionsService.mockResolvedValue(Array.from({ length: 60 }, () => makeConnection()) as never);

    const defaulted = (await call({ tool, args: {} })) as { connections: unknown[]; total: number };
    const capped = (await call({ tool, args: { limit: 4 } })) as { connections: unknown[]; total: number };

    expect(defaulted.connections).toHaveLength(50);
    expect(defaulted.total).toBe(60);
    expect(capped.connections).toHaveLength(4);
  });

  it('reads one connection with its accounts and consent, scoped to the caller, without secrets', async () => {
    connectionDetailsService.mockResolvedValue(makeDetails() as never);

    const result = await call({ tool, args: { connectionId: CONNECTION_ID } });
    const text = JSON.stringify(result);

    expect(connectionDetailsService).toHaveBeenCalledWith({ connectionId: CONNECTION_ID, userId: 42 });
    expect(connectionsService).not.toHaveBeenCalled();
    expect(text).not.toMatch(/secret|sessionId|consentToken|externalId|PL6110|logoUrl|documentationUrl|description/);
    expect(result).toEqual({
      connection: {
        id: CONNECTION_ID,
        providerType: 'enablebanking',
        providerName: 'Some Bank',
        isActive: true,
        lastSyncAt: '2026-10-17T08:00:00.000Z',
        createdAt: '2026-09-01T08:00:00.000Z',
        provider: {
          name: 'Enable Banking',
          features: {
            supportsWebhooks: false,
            supportsRealtime: false,
            requiresReauth: true,
            supportsManualSync: true,
            supportsAutoSync: true,
            defaultSyncInterval: 3600,
            minSyncInterval: 600,
          },
        },
        accounts: [
          {
            id: ACCOUNT_ID,
            name: 'Main',
            currentBalance: 1234.56,
            currencyCode: 'EUR',
            type: 'system',
            currencyFallback: null,
          },
        ],
        consent: {
          validFrom: '2026-09-01',
          validUntil: '2026-12-01',
          daysRemaining: 44,
          isExpired: false,
          isExpiringSoon: false,
        },
        deactivationReason: null,
      },
    });
  });

  it("refuses another user's connection with the service's not-found error", async () => {
    connectionDetailsService.mockRejectedValue(new NotFoundError({ message: 'Connection not found' }));

    await expect(tool.handler({ connectionId: CONNECTION_ID }, READER)).rejects.toThrow('Connection not found');
    expect(connectionDetailsService).toHaveBeenCalledWith({ connectionId: CONNECTION_ID, userId: 42 });
  });
});

describe('get_bank_sync_status', () => {
  const tool = captureTools({ register: registerGetBankSyncStatus })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  const makeStatus = () => ({
    lastSyncAt: 1_760_688_000_000,
    accounts: [
      {
        accountId: ACCOUNT_ID,
        accountName: 'Main',
        providerType: 'monobank',
        status: 'failed',
        startedAt: '2026-10-17T07:59:00.000Z',
        completedAt: null,
        error: 'Rate limited',
        internalDebug: 'provider-session-secret',
      },
    ],
    connectionsNeedingReauth: [
      {
        connectionId: CONNECTION_ID,
        providerType: 'enablebanking',
        providerName: 'Some Bank',
        bankName: 'Some Bank',
        accountsCount: 1,
        deactivatedAt: '2026-10-16T08:00:00.000Z',
        reauthUrl: 'https://bank.example.com/consent-secret',
      },
    ],
    connectionStatuses: [
      {
        connectionId: CONNECTION_ID,
        isActive: false,
        consentExpired: true,
        consentExpiringSoon: false,
        daysRemaining: -2,
      },
    ],
    summary: { total: 1, syncing: 0, queued: 0, completed: 0, failed: 1, idle: 0 },
  });

  const slimStatus = {
    lastSyncAt: 1_760_688_000_000,
    accounts: [
      {
        accountId: ACCOUNT_ID,
        accountName: 'Main',
        providerType: 'monobank',
        status: 'failed',
        startedAt: '2026-10-17T07:59:00.000Z',
        completedAt: null,
        error: 'Rate limited',
      },
    ],
    connectionsNeedingReauth: [
      {
        connectionId: CONNECTION_ID,
        providerType: 'enablebanking',
        providerName: 'Some Bank',
        bankName: 'Some Bank',
        accountsCount: 1,
        deactivatedAt: '2026-10-16T08:00:00.000Z',
      },
    ],
    connectionStatuses: [
      {
        connectionId: CONNECTION_ID,
        isActive: false,
        consentExpired: true,
        consentExpiringSoon: false,
        daysRemaining: -2,
      },
    ],
    summary: { total: 1, syncing: 0, queued: 0, completed: 0, failed: 1, idle: 0 },
  };

  const jobs = [{ jobGroupId: '42-abc-1', connectionId: CONNECTION_ID, accountId: ACCOUNT_ID, status: 'active' }];

  it('registers under its name, takes an optional job group id and says syncing is done in the app', () => {
    expect(tool.name).toBe('get_bank_sync_status');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['jobGroupId']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ jobGroupId: '42-abc-1' }).success).toBe(true);
    expect(schema.safeParse({ jobGroupId: '' }).success).toBe(false);
    expect(schema.safeParse({ jobGroupId: 'x'.repeat(256) }).success).toBe(false);
    expect(tool.config.description).toMatch(/in the app/i);
  });

  it('reads the per-account status and the active jobs of the caller, by whitelist', async () => {
    syncStatusService.mockResolvedValue(makeStatus() as never);
    activeJobsService.mockResolvedValue(jobs as never);

    const result = await call({ tool, args: {} });

    expect(syncStatusService).toHaveBeenCalledWith(42);
    expect(activeJobsService).toHaveBeenCalledWith(42);
    expect(jobProgressService).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/secret|internalDebug|reauthUrl/);
    expect(result).toEqual({ status: slimStatus, activeJobs: jobs });
  });

  it('adds the progress of a job group, scoped to the caller', async () => {
    syncStatusService.mockResolvedValue(makeStatus() as never);
    activeJobsService.mockResolvedValue([] as never);
    jobProgressService.mockResolvedValue({
      totalBatches: 4,
      completedBatches: 1,
      failedBatches: 0,
      activeBatches: 1,
      waitingBatches: 2,
      status: 'active',
      progress: 25,
    } as never);

    const result = await call({ tool, args: { jobGroupId: '42-abc-1' } });

    expect(jobProgressService).toHaveBeenCalledWith({ jobGroupId: '42-abc-1', userId: 42 });
    expect(result).toEqual({
      status: slimStatus,
      activeJobs: [],
      jobGroupProgress: {
        totalBatches: 4,
        completedBatches: 1,
        failedBatches: 0,
        activeBatches: 1,
        waitingBatches: 2,
        status: 'active',
        progress: 25,
      },
    });
  });

  it('refuses a demo user, as GET /bank-data-providers/sync/status does', async () => {
    await expect(tool.handler({}, DEMO_READER)).rejects.toThrow(/demo mode/);
    expect(syncStatusService).not.toHaveBeenCalled();
    expect(activeJobsService).not.toHaveBeenCalled();
  });
});
