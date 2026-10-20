import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findTransactions: jest.fn(),
}));
jest.mock('@services/transactions/matching-transactions', () => ({ resolveBulkTargetIds: jest.fn() }));
jest.mock('@services/sharing/auth/get-accessible-account-ids.service', () => ({
  getAccessibleAccountIdsForUser: jest.fn(),
}));

import * as transactionsQuery from '@models/transactions-query';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';
import { resolveBulkTargetIds } from '@services/transactions/matching-transactions';

import { resolveToolPolicy } from '../../policies';
import { hashTargetIds } from '../snapshot';
import { resolveBulkDeleteTransactions, resolveBulkUpdateTransactions } from './bulk-transactions';
import { PreviewError } from './preview-helpers';

const USER = 7;
const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const OTHER_ACCOUNT = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const CATEGORY = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const tx = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(n),
  time: new Date(Date.UTC(2026, 9, 1 + (n % 20))),
  accountId: ACCOUNT,
  transactionType: TRANSACTION_TYPES.expense,
  amount: Money.fromDecimal(10 + n),
  currencyCode: 'USD',
  categoryId: CATEGORY,
  payeeId: null,
  note: `note ${n}`,
  transferId: null,
  updatedAt: new Date(Date.UTC(2026, 9, 10 + (n % 5))),
  ...overrides,
});

const find = () => jest.mocked(transactionsQuery.findTransactions);

const run = ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
  (toolName === 'bulk_delete_transactions' ? resolveBulkDeleteTransactions : resolveBulkUpdateTransactions)({
    userId: USER,
    toolName,
    args,
    policy: resolveToolPolicy({ name: toolName, args })!,
  });

describe('bulk transaction previews', () => {
  beforeEach(() => {
    find().mockReset();
    jest.mocked(resolveBulkTargetIds).mockReset();
    jest.mocked(getAccessibleAccountIdsForUser).mockReset().mockResolvedValue([ACCOUNT, OTHER_ACCOUNT]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('bulk_update_transactions', () => {
    it('loads the given ids and shows the count and at most 10 sample rows', async () => {
      const rows = Array.from({ length: 14 }, (_, index) => tx(index + 1));
      find().mockResolvedValue(rows as never);
      const ids = rows.map((row) => row.id);

      const { preview, affectedCount, snapshot } = await run({
        toolName: 'bulk_update_transactions',
        args: { transactionIds: ids, categoryId: CATEGORY },
      });

      expect(find().mock.calls[0]![0]).toMatchObject({ access: { creator: USER }, where: { id: ids } });
      expect(affectedCount).toBe(14);
      expect(preview.affected).toMatchObject({ count: 14, truncated: true });
      expect(preview.affected!.rows).toHaveLength(10);
      expect(preview.affected!.rows[0]).toMatchObject({
        account: { kind: 'account', id: ACCOUNT },
        amount: 11,
        currency: 'USD',
        category: { kind: 'category', id: CATEGORY },
        payee: null,
      });
      expect(snapshot).toMatchObject({
        targetHash: hashTargetIds({ ids }),
        targetCount: 14,
        updatedAt: new Date(Date.UTC(2026, 9, 14)).toISOString(),
      });
      expect(snapshot.targetIds).toBeUndefined();
    });

    it('counts a row on an account the user can no longer see but shows none of its details', async () => {
      jest.mocked(getAccessibleAccountIdsForUser).mockResolvedValue([ACCOUNT]);
      find().mockResolvedValue([tx(1), tx(2, { accountId: OTHER_ACCOUNT })] as never);

      const { preview, affectedCount, snapshot } = await run({
        toolName: 'bulk_update_transactions',
        args: { transactionIds: [uuid(1), uuid(2)], note: 'x' },
      });

      expect(affectedCount).toBe(2);
      expect(preview.affected!.count).toBe(2);
      expect(preview.affected!.rows.map((row) => (row.account as { id: string }).id)).toEqual([ACCOUNT]);
      expect(snapshot.targetCount).toBe(2);
    });

    it('keeps the rows untruncated when there are 10 or fewer', async () => {
      find().mockResolvedValue([tx(1), tx(2)] as never);

      const { preview } = await run({
        toolName: 'bulk_update_transactions',
        args: { transactionIds: [uuid(1), uuid(2)], note: 'x' },
      });

      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(preview.affected!.rows).toHaveLength(2);
    });

    it('warns about ids that are not the user transactions, and refuses when none is', async () => {
      find().mockResolvedValue([tx(1)] as never);

      const { warnings, affectedCount } = await run({
        toolName: 'bulk_update_transactions',
        args: { transactionIds: [uuid(1), uuid(2), uuid(3)], note: 'x' },
      });

      expect(affectedCount).toBe(1);
      expect(warnings).toEqual([{ key: 'chat.warnings.targetsMissing', params: { count: 2 } }]);

      find().mockResolvedValue([] as never);
      await expect(
        run({ toolName: 'bulk_update_transactions', args: { transactionIds: [uuid(1)], note: 'x' } }),
      ).rejects.toBeInstanceOf(PreviewError);
    });

    it('refuses ids that are pending proposals', async () => {
      await expect(
        run({
          toolName: 'bulk_update_transactions',
          args: { transactionIds: [`$proposal:${uuid(1)}`], note: 'x' },
        }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.targetIsProposal' });
      expect(find()).not.toHaveBeenCalled();
    });
  });

  describe('bulk_delete_transactions', () => {
    it('shows explicit ids as they are, with the count and sample rows', async () => {
      jest
        .mocked(resolveBulkTargetIds)
        .mockImplementation((async ({ transactionIds }: any) => transactionIds) as never);
      find().mockResolvedValue([tx(1), tx(2), tx(3)] as never);

      const { preview, affectedCount, snapshot } = await run({
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [uuid(1), uuid(2), uuid(3)] },
      });

      expect(affectedCount).toBe(3);
      expect(preview.affected).toMatchObject({ count: 3, truncated: false });
      expect(snapshot.targetIds).toEqual([uuid(1), uuid(2), uuid(3)]);
    });

    it('resolves filters through resolveBulkTargetIds after validating them, and freezes the ids and their hash', async () => {
      const ids = [uuid(3), uuid(1), uuid(2)];
      jest.mocked(resolveBulkTargetIds).mockResolvedValue(ids);
      find().mockResolvedValue([tx(1), tx(2), tx(3)] as never);

      const { snapshot, affectedCount } = await run({
        toolName: 'bulk_delete_transactions',
        args: { filters: { categoryIds: [CATEGORY] }, excludedIds: [uuid(9)] },
      });

      const target = jest.mocked(resolveBulkTargetIds).mock.calls[0]![0];
      expect(target.userId).toBe(USER);
      expect(target.selection).toMatchObject({ excludedIds: [uuid(9)] });
      expect(snapshot.targetIds).toEqual([...ids].toSorted());
      expect(snapshot.targetHash).toBe(hashTargetIds({ ids }));
      expect(snapshot.targetCount).toBe(3);
      expect(affectedCount).toBe(3);
    });

    it('refuses empty filters the way the MCP handler does, without reading anything', async () => {
      await expect(run({ toolName: 'bulk_delete_transactions', args: { filters: {} } })).rejects.toThrow(
        /narrowing filter/,
      );
      expect(resolveBulkTargetIds).not.toHaveBeenCalled();
      expect(find()).not.toHaveBeenCalled();
    });

    it('refuses a filter that matches nothing', async () => {
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([]);

      await expect(
        run({ toolName: 'bulk_delete_transactions', args: { filters: { categoryIds: [CATEGORY] } } }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.noTargets' });
    });

    it('counts and lists the other leg of a transfer, and its account', async () => {
      const leg = tx(1, { transferId: uuid(100), transactionType: TRANSACTION_TYPES.expense });
      const twin = tx(2, {
        transferId: uuid(100),
        accountId: OTHER_ACCOUNT,
        transactionType: TRANSACTION_TYPES.income,
      });
      const plain = tx(3);
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([leg.id, plain.id]);
      find()
        .mockResolvedValueOnce([leg, plain] as never)
        .mockResolvedValueOnce([twin] as never);

      const { preview, affectedCount, warnings, snapshot } = await run({
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [leg.id, plain.id] },
      });

      expect(find().mock.calls[1]![0]).toMatchObject({ where: { transferId: [uuid(100)] } });
      expect(affectedCount).toBe(3);
      expect(preview.affected!.count).toBe(3);
      expect(preview.affected!.rows.map((row) => (row.account as { id: string }).id)).toEqual([
        ACCOUNT,
        OTHER_ACCOUNT,
        ACCOUNT,
      ]);
      expect(warnings).toEqual([{ key: 'chat.warnings.transferTwins', params: { count: 1 } }]);
      // The frozen ids are the ones the handler gets; the twin goes with its leg.
      expect(snapshot.targetIds).toEqual([leg.id, plain.id].toSorted());
      expect(snapshot.targetCount).toBe(2);
    });

    it('counts a twin the deletion removes even when another user created it', async () => {
      const leg = tx(1, { transferId: uuid(100) });
      const twin = tx(2, {
        transferId: uuid(100),
        accountId: OTHER_ACCOUNT,
        updatedAt: new Date('2026-10-17T00:00:00Z'),
      });
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([leg.id]);
      find()
        .mockResolvedValueOnce([leg] as never)
        .mockResolvedValueOnce([twin] as never);

      const { affectedCount, snapshot } = await run({
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [leg.id] },
      });

      // The deletion finds both legs by `transferId` alone, so the lookup is not limited to the creator.
      expect(find().mock.calls[1]![0]).toMatchObject({
        access: 'unscoped-internal',
        where: { transferId: [uuid(100)] },
      });
      expect(affectedCount).toBe(2);
      expect(snapshot.updatedAt).toBe('2026-10-17T00:00:00.000Z');
    });

    it('counts a twin on an account the user cannot see but shows none of its details', async () => {
      const leg = tx(1, { transferId: uuid(100) });
      const hidden = tx(2, { transferId: uuid(100), accountId: OTHER_ACCOUNT });
      jest.mocked(getAccessibleAccountIdsForUser).mockResolvedValue([ACCOUNT]);
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([leg.id]);
      find()
        .mockResolvedValueOnce([leg] as never)
        .mockResolvedValueOnce([hidden] as never);

      const { preview, affectedCount, warnings } = await run({
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [leg.id] },
      });

      expect(affectedCount).toBe(2);
      expect(preview.affected!.count).toBe(2);
      expect(preview.affected!.rows.map((row) => (row.account as { id: string }).id)).toEqual([ACCOUNT]);
      expect(preview.counts).toEqual({ transactionCount: 1, transferTwinCount: 1 });
      expect(warnings).toEqual([{ key: 'chat.warnings.transferTwins', params: { count: 1 } }]);
    });

    it('counts a target on an account the user can no longer see but shows none of its details', async () => {
      const hidden = tx(2, { accountId: OTHER_ACCOUNT });
      jest.mocked(getAccessibleAccountIdsForUser).mockResolvedValue([ACCOUNT]);
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([uuid(1), hidden.id]);
      find().mockResolvedValue([tx(1), hidden] as never);

      const { preview, affectedCount, snapshot } = await run({
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [uuid(1), hidden.id] },
      });

      expect(affectedCount).toBe(2);
      expect(preview.affected!.count).toBe(2);
      expect(preview.affected!.rows.map((row) => (row.account as { id: string }).id)).toEqual([ACCOUNT]);
      expect(snapshot.targetCount).toBe(2);
    });

    it('holds the targets and their twins FOR UPDATE when asked to lock', async () => {
      const leg = tx(1, { transferId: uuid(100) });
      const twin = tx(2, { transferId: uuid(100), accountId: OTHER_ACCOUNT });
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([leg.id]);
      find()
        .mockResolvedValueOnce([leg] as never)
        .mockResolvedValueOnce([twin] as never);

      await resolveBulkDeleteTransactions({
        userId: USER,
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [leg.id] },
        policy: resolveToolPolicy({ name: 'bulk_delete_transactions', args: { transactionIds: [leg.id] } })!,
        lock: true,
      });

      expect(find().mock.calls[0]![0]).toMatchObject({ lock: true });
      expect(find().mock.calls[1]![0]).toMatchObject({ lock: true });
    });

    it('does not list a twin twice when both legs are selected', async () => {
      const leg = tx(1, { transferId: uuid(100) });
      const twin = tx(2, { transferId: uuid(100), accountId: OTHER_ACCOUNT });
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([leg.id, twin.id]);
      find()
        .mockResolvedValueOnce([leg, twin] as never)
        .mockResolvedValueOnce([] as never);

      const { affectedCount, warnings } = await run({
        toolName: 'bulk_delete_transactions',
        args: { transactionIds: [leg.id, twin.id] },
      });

      expect(affectedCount).toBe(2);
      expect(warnings).toBeUndefined();
    });

    it('counts a twin for the updatedAt of the snapshot', async () => {
      const leg = tx(1, { transferId: uuid(100), updatedAt: new Date('2026-10-01T00:00:00Z') });
      const twin = tx(2, { transferId: uuid(100), updatedAt: new Date('2026-10-17T00:00:00Z') });
      jest.mocked(resolveBulkTargetIds).mockResolvedValue([leg.id]);
      find()
        .mockResolvedValueOnce([leg] as never)
        .mockResolvedValueOnce([twin] as never);

      const { snapshot } = await run({ toolName: 'bulk_delete_transactions', args: { transactionIds: [leg.id] } });

      expect(snapshot.updatedAt).toBe('2026-10-17T00:00:00.000Z');
    });
  });
});
