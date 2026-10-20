import { USER_ROLES, type RecordId } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatProposals from '@models/chat-proposals.model';
import * as usersCurrencies from '@models/users-currencies.model';
import { Op } from 'sequelize';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
// The names of the records a card points at come from the database; these suites run without one.
jest.mock('./card-labels', () => ({ resolveCardLabels: jest.fn(async () => ({})) }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));
jest.mock('../../mcp/auth', () => ({ buildMcpAuthInfo: jest.fn() }));
jest.mock('../threads/thread-events', () => ({ notifyThreadUpdated: jest.fn() }));
// A transaction here is a marker in the event log: begin, then commit or rollback.
jest.mock('@services/common/with-transaction', () => ({
  withTransaction:
    <T extends unknown[], R>(fn: (...args: T) => Promise<R>) =>
    async (...args: T): Promise<R> => {
      (globalThis as unknown as { mockApprovalEvents: string[] }).mockApprovalEvents.push('begin');
      try {
        const result = await fn(...args);
        (globalThis as unknown as { mockApprovalEvents: string[] }).mockApprovalEvents.push('commit');
        return result;
      } catch (error) {
        (globalThis as unknown as { mockApprovalEvents: string[] }).mockApprovalEvents.push('rollback');
        throw error;
      }
    },
}));

import { stubCatalog } from '@tests/helpers/chat-toolkit';

import { buildMcpAuthInfo } from '../../mcp/auth';
import * as toolCatalog from '../../mcp/tool-catalog';
import { approveProposal } from './approve';
import { PREVIEW_RESOLVERS } from './previews';
import { hashTargetIds } from './snapshot';

const events: string[] = [];
(globalThis as unknown as { mockApprovalEvents: string[] }).mockApprovalEvents = events;

const USER = { id: 42, username: 'jane', authUserId: 'auth-42' as RecordId, role: USER_ROLES.common };
const THREAD = '1b4e28ba-2fa1-4d2b-8a5c-3c6f0a9d7e10';
const MESSAGE = '7c9e6679-7425-4a40-b5a1-9f3d6c2e8b14';
const CATEGORY = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const TAG = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const TX = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const IMPORT = 'f0e1d2c3-b4a5-4968-8776-655443322110';
const BATCH = '6e5d4c3b-2a19-4807-96f5-e4d3c2b1a099';
const BULK = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';
const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const REAL_CATEGORY = '11111111-1111-4111-8111-111111111111';
const REAL_TAG = '22222222-2222-4222-8222-222222222222';
const TRANSACTION_IDS = ['c1111111-1111-4111-8111-111111111111', 'c2222222-2222-4222-8222-222222222222'];

type Row = Record<string, any>;
let rows: Map<string, Row>;
let writes: Array<{ id: string; values: Row }>;

const row = (id: string, overrides: Row = {}): Row => ({
  id,
  userId: USER.id,
  threadId: THREAD,
  messageId: MESSAGE,
  toolName: 'create_category',
  status: 'pending',
  statusReason: null,
  revision: 1,
  entity: 'category',
  cardKind: 'create',
  args: { name: 'Food' },
  proposedArgs: { name: 'Food' },
  danger: 'none',
  confirmation: 'none',
  confirmationPhrase: null,
  preview: null,
  snapshot: { baseCurrencyCode: 'USD', parentStatuses: {} },
  uncertainFields: null,
  sources: [],
  dependsOn: [],
  editedFields: [],
  executedArgs: null,
  chainId: null,
  result: null,
  error: null,
  createdAt: new Date('2026-10-18T09:00:00.000Z'),
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  decidedAt: null,
  appliedAt: null,
  ...overrides,
});

const seed = (...items: Row[]) => {
  for (const item of items) rows.set(item.id, item);
};

const matches = ({ item, where }: { item: Row; where: Row }) =>
  Object.entries(where).every(([key, expected]) => {
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
      const lte = (expected as Record<symbol, Date>)[Op.lte];
      return lte === undefined || item[key].getTime() <= lte.getTime();
    }
    return Array.isArray(expected) ? expected.includes(item[key]) : item[key] === expected;
  });

const chain = () => ({
  category: row(CATEGORY, { toolName: 'create_category', args: { name: 'Food' } }),
  tag: row(TAG, { toolName: 'create_tag', entity: 'tag', args: { name: 'Coffee', color: '#aa0000' } }),
  tx: row(TX, {
    toolName: 'create_transaction',
    entity: 'transaction',
    args: {
      accountId: ACCOUNT,
      amount: 4.5,
      transactionType: 'expense',
      paymentType: 'creditCard',
      transferNature: 'not_transfer',
      categoryId: `$proposal:${CATEGORY}`,
      tagIds: [`$proposal:${TAG}`],
    },
    dependsOn: [CATEGORY, TAG],
    snapshot: { baseCurrencyCode: 'USD', parentStatuses: { [CATEGORY]: 'pending', [TAG]: 'pending' } },
  }),
});

let catalog: ReturnType<typeof stubCatalog>;
const handler = ({ name }: { name: string }) =>
  catalog.find((entry) => entry.name === name)!.invoke as unknown as jest.Mock<
    (...args: unknown[]) => Promise<unknown>
  >;

const approve = (params: {
  id: string;
  revision?: number;
  parentRevisions?: Record<string, number>;
  confirmation?: string;
}) =>
  approveProposal({
    user: USER,
    proposalId: params.id,
    revision: params.revision ?? 1,
    parentRevisions: params.parentRevisions,
    confirmation: params.confirmation,
  });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as Error & { httpCode: number; details?: Record<string, any> };
  }
  throw new Error('expected the approval to be refused');
};

describe('approveProposal', () => {
  beforeEach(() => {
    events.length = 0;
    rows = new Map();
    writes = [];
    catalog = stubCatalog({
      implementations: {
        create_category: () => ({ id: REAL_CATEGORY, name: 'Food' }),
        create_tag: () => ({ id: REAL_TAG, name: 'Coffee' }),
        create_transaction: () => [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
      },
    });
    jest.spyOn(toolCatalog, 'getToolCatalog').mockReturnValue(catalog);
    jest
      .spyOn(toolCatalog, 'findToolCatalogEntry')
      .mockImplementation(({ name }) => catalog.find((entry) => entry.name === name));
    for (const entry of catalog) {
      const invoke = entry.invoke as unknown as jest.Mock<(...args: unknown[]) => Promise<unknown>>;
      const original = invoke.getMockImplementation()!;
      invoke.mockImplementation(async (...args) => {
        events.push(`handler:${entry.name}`);
        return original(...args);
      });
    }
    for (const key of Object.keys(PREVIEW_RESOLVERS)) delete (PREVIEW_RESOLVERS as Record<string, unknown>)[key];

    jest.mocked(buildMcpAuthInfo).mockImplementation((async ({ user, clientId, scopes, token }: any) => ({
      token,
      clientId,
      scopes,
      extra: {
        userId: user.id,
        authUserId: user.authUserId,
        username: user.username,
        role: user.role,
        readOnly: false,
        features: [],
      },
    })) as never);
    jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'USD' } as never);

    jest.spyOn(ChatProposals, 'findOne').mockImplementation((async ({ where }: any) => {
      return [...rows.values()].find((item) => matches({ item, where })) ?? null;
    }) as never);
    jest.spyOn(ChatProposals, 'findAll').mockImplementation((async ({ where, lock }: any) => {
      events.push(lock ? 'lock' : 'read');
      return [...rows.values()].filter((item) => matches({ item, where })).toSorted((a, b) => a.id.localeCompare(b.id));
    }) as never);
    jest.spyOn(ChatProposals, 'update').mockImplementation((async (values: Row, { where }: any) => {
      const targets = [...rows.values()].filter((item) => matches({ item, where }));
      for (const target of targets) {
        Object.assign(target, values);
        writes.push({ id: target.id, values });
        events.push(`write:${values.status}`);
      }
      return [targets.length];
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(PREVIEW_RESOLVERS)) delete (PREVIEW_RESOLVERS as Record<string, unknown>)[key];
  });

  describe('a chain of normal tools', () => {
    it('runs the lock, the handlers and the status writes inside one transaction', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);

      const response = await approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } });

      const begin = events.indexOf('begin');
      const commit = events.lastIndexOf('commit');
      expect(events.filter((event) => event === 'begin')).toHaveLength(1);
      expect(events.indexOf('lock')).toBeGreaterThan(begin);
      for (const event of events.filter((item) => item.startsWith('handler:') || item.startsWith('write:'))) {
        expect(events.indexOf(event)).toBeGreaterThan(begin);
        expect(events.indexOf(event)).toBeLessThan(commit);
      }
      expect(events.filter((event) => event.startsWith('handler:'))).toHaveLength(3);
      expect(events.filter((event) => event === 'write:applied')).toHaveLength(3);
      expect(response.card).toMatchObject({ id: TX, status: 'applied' });
      expect(response.cards.map((card) => card.id).toSorted()).toEqual([CATEGORY, TAG, TX].toSorted());
    });

    it('locks every card of the chain in one query in ascending id order, whatever the depth of each', async () => {
      // A transaction on a subcategory of a category: three levels, whose ids sort the other way round.
      const grandparent = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const parent = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const child = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      seed(
        row(grandparent, { toolName: 'create_category', args: { name: 'Food' } }),
        row(parent, {
          toolName: 'create_category',
          args: { name: 'Coffee', parentId: `$proposal:${grandparent}` },
          dependsOn: [grandparent],
          snapshot: { baseCurrencyCode: 'USD', parentStatuses: { [grandparent]: 'pending' } },
        }),
        row(child, {
          toolName: 'create_transaction',
          entity: 'transaction',
          args: {
            accountId: ACCOUNT,
            amount: 4.5,
            transactionType: 'expense',
            paymentType: 'creditCard',
            transferNature: 'not_transfer',
            categoryId: `$proposal:${parent}`,
          },
          dependsOn: [parent],
          snapshot: { baseCurrencyCode: 'USD', parentStatuses: { [parent]: 'pending' } },
        }),
      );

      await approve({ id: child, parentRevisions: { [grandparent]: 1, [parent]: 1 } });

      const locked = jest
        .mocked(ChatProposals.findAll)
        .mock.calls.filter(([options]) => (options as { lock?: boolean }).lock)
        .map(([options]) => (options as { where: { id: string | string[] } }).where.id);
      expect(locked.flat()).toEqual([grandparent, parent, child]);
    });

    it('locks the whole chain with one query', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);

      await approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } });

      expect(events.filter((event) => event === 'lock')).toHaveLength(1);
    });

    it('asks the preview resolver to lock the rows it reads, so no edit slips in before the write', async () => {
      seed(
        row(CATEGORY, {
          toolName: 'update_account',
          entity: 'account',
          cardKind: 'update',
          args: { accountId: ACCOUNT, name: 'Wallet' },
          preview: {},
          snapshot: {
            baseCurrencyCode: 'USD',
            updatedAt: '2026-10-18T09:00:00.000Z',
            targetHash: hashTargetIds({ ids: [ACCOUNT] }),
            targetCount: 1,
          },
        }),
      );
      const resolver = jest.fn<(typeof PREVIEW_RESOLVERS)['entity']>(async () => ({
        preview: {},
        snapshot: {
          updatedAt: '2026-10-18T09:00:00.000Z',
          targetHash: hashTargetIds({ ids: [ACCOUNT] }),
          targetCount: 1,
        },
      }));
      PREVIEW_RESOLVERS.entity = resolver;

      await approve({ id: CATEGORY });

      expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ lock: true }));
    });

    it('applies the parents first and hands the child their real ids', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);

      await approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } });

      const handlerEvents = events.filter((event) => event.startsWith('handler:'));
      expect(handlerEvents.at(-1)).toBe('handler:create_transaction');
      expect(handler({ name: 'create_transaction' })).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({ categoryId: REAL_CATEGORY, tagIds: [REAL_TAG] }),
        }),
      );
      expect(rows.get(TX)).toMatchObject({
        status: 'applied',
        executedArgs: expect.objectContaining({ categoryId: REAL_CATEGORY }),
        result: {
          refs: [{ kind: 'transaction', id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
          alsoApplied: expect.any(Array),
        },
      });
      expect(rows.get(TX)!.result.alsoApplied.toSorted()).toEqual([CATEGORY, TAG].toSorted());
      expect(rows.get(CATEGORY)!.chainId).toBe(rows.get(TX)!.chainId);
      expect(rows.get(CATEGORY)!.chainId).not.toBeNull();
    });

    it('runs the handler with the full-scope chat context', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);

      await approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } });

      const extra = (handler({ name: 'create_category' }).mock.calls[0]![0] as any).extra;
      expect(extra.authInfo).toMatchObject({
        clientId: 'moneymatter-chat',
        scopes: ['finance:read', 'finance:write', 'finance:delete'],
        extra: { userId: USER.id },
      });
    });

    it('answers a repeated approve with the applied card and runs nothing again', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);
      await approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } });
      handler({ name: 'create_transaction' }).mockClear();
      writes.length = 0;

      const again = await approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } });

      expect(again.card).toMatchObject({ id: TX, status: 'applied' });
      expect(handler({ name: 'create_transaction' })).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('leaves no applied status when a handler fails, and records the failure after the rollback', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);
      handler({ name: 'create_transaction' }).mockImplementation(async () => {
        events.push('handler:create_transaction');
        throw new Error('Account not found');
      });

      const error = await failure(approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } }));

      expect(error.httpCode).toBe(ERROR_CODES.ValidationError);
      expect(error.message).toBe('Account not found');
      expect(error.details).toMatchObject({ reason: 'failed', card: { id: TX, status: 'failed' } });
      expect(events).not.toContain('write:applied');
      expect(events.indexOf('rollback')).toBeLessThan(events.indexOf('write:failed'));
      for (const id of [CATEGORY, TAG, TX]) {
        expect(rows.get(id)).toMatchObject({ status: 'failed', error: { message: 'Account not found' } });
      }
    });

    it('skips the failed write of a card whose revision moved on meanwhile, and returns the current card', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);
      handler({ name: 'create_transaction' }).mockImplementation(async () => {
        // Another tab edited the card while the approval ran.
        rows.get(TX)!.revision = 2;
        throw new Error('Account not found');
      });

      const error = await failure(approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } }));

      expect(rows.get(TX)).toMatchObject({ status: 'pending', revision: 2 });
      expect(rows.get(CATEGORY)!.status).toBe('failed');
      expect(error.details!.card).toMatchObject({ id: TX, status: 'pending', revision: 2 });
    });

    it('answers 409 with the current card when the revision is old, and runs nothing', async () => {
      const { category, tag, tx } = chain();
      seed(category, tag, tx);
      tx.revision = 3;

      const error = await failure(approve({ id: TX, revision: 2, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } }));

      expect(error.httpCode).toBe(ERROR_CODES.ConflictError);
      expect(error.details).toMatchObject({ reason: 'revision', card: { id: TX, revision: 3 } });
      expect(events.filter((event) => event.startsWith('handler:'))).toEqual([]);
    });

    it('answers 409 when a parent was rejected', async () => {
      const { category, tag, tx } = chain();
      category.status = 'rejected';
      seed(category, tag, tx);

      const error = await failure(approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } }));

      expect(error.httpCode).toBe(ERROR_CODES.ConflictError);
      expect(error.details).toMatchObject({ reason: 'blocked' });
      expect(events.filter((event) => event.startsWith('handler:'))).toEqual([]);
    });

    it('answers 409 and marks the card expired when it is past its lifetime', async () => {
      const { category, tag, tx } = chain();
      tx.expiresAt = new Date(Date.now() - 1_000);
      seed(category, tag, tx);

      const error = await failure(approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } }));

      expect(error.httpCode).toBe(ERROR_CODES.ConflictError);
      expect(error.details).toMatchObject({ reason: 'expired' });
      expect(rows.get(TX)!.status).toBe('expired');
    });

    it('runs the real validators on the original arguments first, so a bad card is refused with 422', async () => {
      const { category, tag, tx } = chain();
      tx.args = { ...tx.args, amount: 'lots' };
      seed(category, tag, tx);

      const error = await failure(approve({ id: TX, parentRevisions: { [CATEGORY]: 1, [TAG]: 1 } }));

      expect(error.httpCode).toBe(ERROR_CODES.ValidationError);
      expect(events.filter((event) => event.startsWith('handler:'))).toEqual([]);
      expect(rows.get(TX)!.status).toBe('pending');
    });

    it('refuses a red card without its confirmation (422) and takes it with the exact one', async () => {
      seed(
        row(CATEGORY, {
          confirmation: 'confirm',
          toolName: 'delete_category',
          cardKind: 'delete',
          danger: 'destructive',
          args: { categoryId: REAL_CATEGORY },
        }),
      );
      PREVIEW_RESOLVERS.entity = async () => ({ preview: {}, snapshot: {} });
      rows.get(CATEGORY)!.preview = {};

      const refused = await failure(approve({ id: CATEGORY }));
      const accepted = await approve({ id: CATEGORY, confirmation: 'confirm' });

      expect(refused.httpCode).toBe(ERROR_CODES.ValidationError);
      expect(accepted.card.status).toBe('applied');
    });

    it('marks the card stale and rolls back when what it was previewed against moved', async () => {
      seed(
        row(CATEGORY, {
          toolName: 'update_account',
          entity: 'account',
          cardKind: 'update',
          args: { accountId: ACCOUNT, name: 'Wallet' },
          preview: {},
          snapshot: {
            baseCurrencyCode: 'USD',
            updatedAt: '2026-10-18T09:00:00.000Z',
            targetHash: hashTargetIds({ ids: [ACCOUNT] }),
            targetCount: 1,
          },
        }),
      );
      PREVIEW_RESOLVERS.entity = async () => ({
        preview: {},
        snapshot: {
          updatedAt: '2026-10-18T10:00:00.000Z',
          targetHash: hashTargetIds({ ids: [ACCOUNT] }),
          targetCount: 1,
        },
      });

      const error = await failure(approve({ id: CATEGORY }));

      expect(error.httpCode).toBe(ERROR_CODES.ConflictError);
      expect(error.details).toMatchObject({
        reason: 'stale',
        stale: {
          reasonKey: 'chat.stale.updated',
          before: '2026-10-18T09:00:00.000Z',
          after: '2026-10-18T10:00:00.000Z',
        },
      });
      expect(rows.get(CATEGORY)).toMatchObject({ status: 'stale', statusReason: 'chat.stale.updated' });
      expect(events).toContain('rollback');
      expect(handler({ name: 'update_account' })).not.toHaveBeenCalled();
    });

    it('does not mark a card stale when its revision moved while the check ran', async () => {
      seed(
        row(CATEGORY, {
          toolName: 'update_account',
          entity: 'account',
          cardKind: 'update',
          args: { accountId: ACCOUNT, name: 'Wallet' },
          preview: {},
          snapshot: {
            baseCurrencyCode: 'USD',
            updatedAt: '2026-10-18T09:00:00.000Z',
            targetHash: hashTargetIds({ ids: [ACCOUNT] }),
            targetCount: 1,
          },
        }),
      );
      PREVIEW_RESOLVERS.entity = async () => {
        rows.get(CATEGORY)!.revision = 2;
        return {
          preview: {},
          snapshot: {
            updatedAt: '2026-10-18T10:00:00.000Z',
            targetHash: hashTargetIds({ ids: [ACCOUNT] }),
            targetCount: 1,
          },
        };
      };

      const error = await failure(approve({ id: CATEGORY }));

      expect(rows.get(CATEGORY)).toMatchObject({ status: 'pending', revision: 2 });
      expect(error.details!.card).toMatchObject({ id: CATEGORY, revision: 2 });
    });

    it('hands a filter-based bulk delete to the handler as the explicit frozen ids', async () => {
      seed(
        row(BULK, {
          toolName: 'bulk_delete_transactions',
          entity: 'transaction',
          cardKind: 'bulk',
          danger: 'destructive',
          confirmation: 'typed',
          confirmationPhrase: '2',
          args: { filters: { accountIds: [ACCOUNT] } },
          preview: {},
          snapshot: {
            baseCurrencyCode: 'USD',
            targetIds: TRANSACTION_IDS,
            targetHash: hashTargetIds({ ids: TRANSACTION_IDS }),
            targetCount: 2,
          },
        }),
      );
      PREVIEW_RESOLVERS.bulkDeleteTransactions = async () => ({
        preview: {},
        snapshot: { targetIds: TRANSACTION_IDS, targetHash: hashTargetIds({ ids: TRANSACTION_IDS }), targetCount: 2 },
        affectedCount: 2,
      });

      await approve({ id: BULK, confirmation: '2' });

      const args = (handler({ name: 'bulk_delete_transactions' }).mock.calls[0]![0] as any).args;
      expect(args).toEqual({ transactionIds: TRANSACTION_IDS });
      expect(rows.get(BULK)).toMatchObject({ status: 'applied', executedArgs: { transactionIds: TRANSACTION_IDS } });
    });

    it('refuses a bulk delete whose filter matches a different set now (stale) before anything runs', async () => {
      seed(
        row(BULK, {
          toolName: 'bulk_delete_transactions',
          entity: 'transaction',
          cardKind: 'bulk',
          danger: 'destructive',
          confirmation: 'typed',
          confirmationPhrase: '2',
          args: { filters: { accountIds: [ACCOUNT] } },
          preview: {},
          snapshot: {
            baseCurrencyCode: 'USD',
            targetIds: TRANSACTION_IDS,
            targetHash: hashTargetIds({ ids: TRANSACTION_IDS }),
            targetCount: 2,
          },
        }),
      );
      const grown = [...TRANSACTION_IDS, 'c3333333-3333-4333-8333-333333333333'];
      PREVIEW_RESOLVERS.bulkDeleteTransactions = async () => ({
        preview: {},
        snapshot: { targetIds: grown, targetHash: hashTargetIds({ ids: grown }), targetCount: 3 },
        affectedCount: 3,
      });

      const error = await failure(approve({ id: BULK, confirmation: '2' }));

      expect(error.details).toMatchObject({
        reason: 'stale',
        stale: { reasonKey: 'chat.stale.targets', before: 2, after: 3 },
      });
      expect(handler({ name: 'bulk_delete_transactions' })).not.toHaveBeenCalled();
    });

    it('refuses a bulk delete edited to empty filters at approval, as the MCP handler does', async () => {
      seed(
        row(BULK, {
          toolName: 'bulk_delete_transactions',
          entity: 'transaction',
          cardKind: 'bulk',
          danger: 'destructive',
          confirmation: 'typed',
          confirmationPhrase: '2',
          args: { filters: {} },
          preview: {},
        }),
      );

      const error = await failure(approve({ id: BULK, confirmation: '2' }));

      expect(error.httpCode).toBe(ERROR_CODES.ValidationError);
      expect(handler({ name: 'bulk_delete_transactions' })).not.toHaveBeenCalled();
    });
  });

  describe('a standalone tool', () => {
    const importCard = (overrides: Row = {}) =>
      row(IMPORT, {
        toolName: 'delete_import_batch',
        entity: 'importBatch',
        cardKind: 'delete',
        danger: 'highImpact',
        confirmation: 'typed',
        confirmationPhrase: '5',
        args: { batchId: BATCH },
        preview: {},
        snapshot: { baseCurrencyCode: 'USD', targetHash: hashTargetIds({ ids: ['3'] }), targetCount: 1 },
        ...overrides,
      });

    beforeEach(() => {
      PREVIEW_RESOLVERS.deleteImportBatch = async () => ({
        preview: {},
        snapshot: { targetHash: hashTargetIds({ ids: ['3'] }), targetCount: 1 },
        affectedCount: 5,
      });
    });

    it('commits the applying claim before the handler runs, then writes the result in a second transaction', async () => {
      seed(importCard());

      const response = await approve({ id: IMPORT, confirmation: '5' });

      expect(
        events.filter((event) =>
          ['begin', 'commit', 'rollback', 'write:applying', 'handler:delete_import_batch', 'write:applied'].includes(
            event,
          ),
        ),
      ).toEqual([
        'begin',
        'write:applying',
        'commit',
        'handler:delete_import_batch',
        'begin',
        'write:applied',
        'commit',
      ]);
      expect(response.card).toMatchObject({ id: IMPORT, status: 'applied' });
    });

    it.each([
      ['an old revision', { revision: 2, confirmation: '5' }, ERROR_CODES.ConflictError],
      ['a missing typed count', { confirmation: undefined }, ERROR_CODES.ValidationError],
      ['a wrong typed count', { confirmation: '4' }, ERROR_CODES.ValidationError],
    ])('refuses %s before the claim', async (_name, params, status) => {
      seed(importCard());

      const error = await failure(approve({ id: IMPORT, ...params }));

      expect(error.httpCode).toBe(status);
      expect(events).not.toContain('write:applying');
      expect(handler({ name: 'delete_import_batch' })).not.toHaveBeenCalled();
      expect(rows.get(IMPORT)!.status).not.toBe('applying');
    });

    it('refuses arguments the validator rejects before the claim', async () => {
      seed(importCard({ args: { batchId: 'not an id' } }));

      const error = await failure(approve({ id: IMPORT, confirmation: '5' }));

      expect(error.httpCode).toBe(ERROR_CODES.ValidationError);
      expect(events).not.toContain('write:applying');
      expect(handler({ name: 'delete_import_batch' })).not.toHaveBeenCalled();
    });

    it('refuses a card whose snapshot moved (stale) before the claim', async () => {
      seed(
        importCard({
          snapshot: { baseCurrencyCode: 'USD', targetHash: hashTargetIds({ ids: ['4'] }), targetCount: 1 },
        }),
      );

      const error = await failure(approve({ id: IMPORT, confirmation: '5' }));

      expect(error.details).toMatchObject({ reason: 'stale' });
      expect(events).not.toContain('write:applying');
      expect(rows.get(IMPORT)!.status).toBe('stale');
    });

    it('records a handler failure as failed and never runs the handler again', async () => {
      seed(importCard());
      handler({ name: 'delete_import_batch' }).mockImplementation(async () => {
        events.push('handler:delete_import_batch');
        throw new Error('Batch is running');
      });

      const error = await failure(approve({ id: IMPORT, confirmation: '5' }));

      expect(error.httpCode).toBe(ERROR_CODES.ValidationError);
      expect(rows.get(IMPORT)).toMatchObject({ status: 'failed', error: { message: 'Batch is running' } });
      handler({ name: 'delete_import_batch' }).mockClear();
      const again = await failure(approve({ id: IMPORT, confirmation: '5' }));
      expect(again.httpCode).toBe(ERROR_CODES.ConflictError);
      expect(handler({ name: 'delete_import_batch' })).not.toHaveBeenCalled();
    });

    it('never runs a card left in applying', async () => {
      seed(importCard({ status: 'applying' }));

      const error = await failure(approve({ id: IMPORT, confirmation: '5' }));

      expect(error.httpCode).toBe(ERROR_CODES.ConflictError);
      expect(handler({ name: 'delete_import_batch' })).not.toHaveBeenCalled();
      expect(rows.get(IMPORT)!.status).toBe('applying');
    });
  });
});
