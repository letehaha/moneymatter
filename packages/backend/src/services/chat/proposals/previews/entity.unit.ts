import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@services/sharing/auth/get-accessible-account-ids.service', () => ({
  getAccessibleAccountIdsForUser: jest.fn(),
}));

import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';

import { resolveToolPolicy } from '../../policies';
import { hashTargetIds } from '../snapshot';
import { resolveEntityPreview } from './entity';
import { ENTITY_LOADERS, type LoadedEntity } from './entity-loaders';
import { PreviewError } from './preview-helpers';

const USER = 7;
const ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const PLAN = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const LINE = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const UPDATED = new Date('2026-10-18T09:00:00.000Z');

const loaded = (overrides: Partial<LoadedEntity> = {}): LoadedEntity => ({
  row: { id: ID, name: 'Cash', amount: 10 },
  updatedAt: UPDATED,
  counts: {},
  removes: 0,
  ...overrides,
});

const stubLoader = ({ kind, result }: { kind: string; result: LoadedEntity | null }) => {
  const loader = jest.fn<
    (params: { userId: number; targets: string[]; args: Record<string, unknown> }) => Promise<LoadedEntity | null>
  >(async () => result);
  (ENTITY_LOADERS as Record<string, unknown>)[kind] = loader;
  return loader;
};

const resolve = ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
  resolveEntityPreview({ userId: USER, toolName, args, policy: resolveToolPolicy({ name: toolName, args })! });

describe('entity preview resolver', () => {
  const originals = { ...ENTITY_LOADERS };

  afterEach(() => {
    for (const key of Object.keys(ENTITY_LOADERS)) delete (ENTITY_LOADERS as Record<string, unknown>)[key];
    Object.assign(ENTITY_LOADERS, originals);
  });

  it('shows the row as it is now on an update card and captures the target', async () => {
    const loader = stubLoader({ kind: 'account', result: loaded() });

    const { preview, snapshot, affectedCount } = await resolve({
      toolName: 'update_account',
      args: { accountId: ID, name: 'Wallet' },
    });

    expect(loader).toHaveBeenCalledWith({
      userId: USER,
      targets: [ID],
      args: { accountId: ID, name: 'Wallet' },
    });
    expect(preview.before).toEqual({ id: ID, name: 'Cash', amount: 10 });
    expect(snapshot).toEqual({
      updatedAt: '2026-10-18T09:00:00.000Z',
      targetHash: hashTargetIds({ ids: [ID] }),
      targetCount: 1,
    });
    expect(affectedCount).toBeUndefined();
  });

  it('warns that a payee delete with ignoreFuture adds the names to the ignore list', async () => {
    stubLoader({ kind: 'payee', result: loaded({ row: { id: ID, name: 'Netflix' } }) });

    const plain = await resolve({ toolName: 'delete_payee', args: { id: ID } });
    const ignoring = await resolve({ toolName: 'delete_payee', args: { id: ID, ignoreFuture: true } });

    expect(plain.warnings).toBeUndefined();
    expect(ignoring.warnings).toEqual([{ key: 'chat.warnings.payeesIgnored' }]);
  });

  it('passes the targets in the order the policy names them', async () => {
    const loader = stubLoader({ kind: 'budgetPlanLine', result: loaded() });

    await resolve({ toolName: 'delete_budget_plan_line', args: { planId: PLAN, lineId: LINE } });

    expect(loader).toHaveBeenCalledWith({ userId: USER, targets: [PLAN, LINE], args: { planId: PLAN, lineId: LINE } });
  });

  it('carries the row and the related counts on a delete card', async () => {
    stubLoader({ kind: 'category', result: loaded({ counts: { transactionCount: 40, subcategoryCount: 2 } }) });

    const { preview, affectedCount } = await resolve({ toolName: 'delete_category', args: { categoryId: ID } });

    expect(preview.before).toMatchObject({ name: 'Cash' });
    expect(preview.counts).toEqual({ transactionCount: 40, subcategoryCount: 2 });
    expect(affectedCount).toBeUndefined();
  });

  it('counts the entity and the rows that go with it, so the typed phrase covers them', async () => {
    stubLoader({ kind: 'account', result: loaded({ counts: { transactionCount: 12 }, removes: 12 }) });

    const { affectedCount } = await resolve({ toolName: 'delete_account', args: { accountId: ID } });

    expect(affectedCount).toBe(13);
  });

  it('counts one record for a high-impact card, which is always typed', async () => {
    stubLoader({ kind: 'account', result: loaded() });

    const { affectedCount } = await resolve({
      toolName: 'unlink_account_from_bank_connection',
      args: { accountId: ID },
    });

    expect(affectedCount).toBe(1);
  });

  it('shows no row for an entity a call creates, such as a first goal', async () => {
    stubLoader({ kind: 'budgetPlanLineGoal', result: loaded({ row: null, updatedAt: null }) });

    const { preview, snapshot } = await resolve({
      toolName: 'set_budget_plan_line_goal',
      args: { planId: PLAN, lineId: LINE, frequency: 'monthly' },
    });

    expect(preview.before).toBeNull();
    expect(snapshot.updatedAt).toBeNull();
  });

  it('refuses a target that is not there, with a key the card translates', async () => {
    stubLoader({ kind: 'tag', result: null });

    const failure = await resolve({ toolName: 'delete_tag', args: { id: ID } }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PreviewError);
    expect((failure as PreviewError).messageKey).toBe('chat.cards.targetNotFound');
  });

  it('refuses a target that is a pending proposal, and does not read anything', async () => {
    const loader = stubLoader({ kind: 'account', result: loaded() });

    const failure = await resolve({
      toolName: 'update_account',
      args: { accountId: `$proposal:${ID}`, name: 'Wallet' },
    }).catch((error: unknown) => error);

    expect((failure as PreviewError).messageKey).toBe('chat.cards.targetIsProposal');
    expect(loader).not.toHaveBeenCalled();
  });

  it('fails when the call does not name its target', async () => {
    stubLoader({ kind: 'account', result: loaded() });

    await expect(resolve({ toolName: 'update_account', args: { name: 'Wallet' } })).rejects.toBeInstanceOf(
      PreviewError,
    );
  });
  describe('a transaction with transfer legs', () => {
    const TWIN = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
    const TRANSFER = '7b1c3d5e-9f20-4a68-8c4e-0d2f4b6a8c13';
    const HIDDEN_ACCOUNT = '8c3d5f70-1a24-4b6e-9d8f-3e5a7c9b1d02';
    const SEEN_ACCOUNT = '2b4d6f80-3c15-4e7a-8f9b-4a6c8e0b2d14';
    const TWIN_UPDATED = new Date('2026-10-18T11:30:00.000Z');

    const leg = ({ id, accountId, updatedAt }: { id: string; accountId: string; updatedAt: Date }) => ({
      id,
      accountId,
      updatedAt,
      time: new Date('2026-10-01T00:00:00.000Z'),
      transactionType: TRANSACTION_TYPES.expense,
      amount: Money.fromDecimal(5),
      currencyCode: 'USD',
      categoryId: null,
      payeeId: null,
      note: '',
      transferId: TRANSFER,
    });

    const withLegs = () => {
      const legs = [
        leg({ id: ID, accountId: SEEN_ACCOUNT, updatedAt: UPDATED }),
        leg({ id: TWIN, accountId: HIDDEN_ACCOUNT, updatedAt: TWIN_UPDATED }),
      ];
      stubLoader({
        kind: 'transaction',
        result: loaded({ counts: { transferTwinCount: 1 }, legs: legs as never }),
      });
      return legs;
    };

    beforeEach(() => {
      jest.mocked(getAccessibleAccountIdsForUser).mockReset().mockResolvedValue([SEEN_ACCOUNT]);
    });

    it('counts both legs on a delete, lists only the one on an account the user can see, and types the count', async () => {
      withLegs();

      const { preview, affectedCount, warnings } = await resolve({ toolName: 'delete_transaction', args: { id: ID } });

      expect(affectedCount).toBe(2);
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(preview.affected!.rows).toHaveLength(1);
      expect(preview.affected!.rows[0]).toMatchObject({ account: { id: SEEN_ACCOUNT } });
      expect(preview.counts).toEqual({ transferTwinCount: 1 });
      expect(warnings).toEqual([{ key: 'chat.warnings.transferTwinsOfRow', params: { count: 1 } }]);
    });

    it('snapshots every leg: the newest update, both ids and the count', async () => {
      withLegs();

      const { snapshot } = await resolve({ toolName: 'delete_transaction', args: { id: ID } });

      expect(snapshot).toEqual({
        updatedAt: TWIN_UPDATED.toISOString(),
        targetHash: hashTargetIds({ ids: [ID, TWIN] }),
        targetCount: 2,
      });
    });

    it('snapshots the other leg of an update too, and lists the legs, but removes nothing', async () => {
      withLegs();

      const { snapshot, affectedCount, warnings, preview } = await resolve({
        toolName: 'update_transaction',
        args: { id: ID, note: 'x' },
      });

      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [ID, TWIN] }), targetCount: 2 });
      expect(affectedCount).toBeUndefined();
      expect(warnings).toBeUndefined();
      expect(preview.affected).toMatchObject({ count: 2 });
    });

    it('shows no affected block for a transaction without another leg', async () => {
      stubLoader({ kind: 'transaction', result: loaded() });

      const { preview, snapshot, warnings } = await resolve({ toolName: 'delete_transaction', args: { id: ID } });

      expect(preview.affected).toBeUndefined();
      expect(warnings).toBeUndefined();
      expect(snapshot.targetCount).toBe(1);
    });

    it('counts the rows an entity delete takes on top of the entity, as before', async () => {
      stubLoader({ kind: 'portfolioTransfer', result: loaded({ counts: { linkedTransactionCount: 1 }, removes: 1 }) });

      const { affectedCount } = await resolve({ toolName: 'delete_portfolio_transfer', args: { transferId: ID } });

      expect(affectedCount).toBe(2);
    });
  });
});
