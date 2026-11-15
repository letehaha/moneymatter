import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import PayeeAliases from '@models/payee-aliases.model';
import PayeeIgnoredNames from '@models/payee-ignored-names.model';
import Payees from '@models/payees.model';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findTransactions: jest.fn(),
  countTransactions: jest.fn(),
}));
jest.mock('@services/payees/payee-namespace', () => ({
  parsePayeeName: jest.fn(),
  resolveNormalizedName: jest.fn(),
}));

import * as transactionsQuery from '@models/transactions-query';
import { parsePayeeName, resolveNormalizedName } from '@services/payees/payee-namespace';

import { resolveToolPolicy } from '../../policies';
import { compareSnapshots, hashTargetIds } from '../snapshot';
import { resolveBulkDeletePayees } from './bulk-delete-payees';
import { resolveIgnorePayeeName } from './ignore-payee-name';
import { resolveMergePayees } from './merge-payees';
import { resolveApplyPayeeTags } from './payee-tags';
import { PreviewError } from './preview-helpers';
import type { PreviewResolver } from './types';

const USER = 7;
const SOURCE = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const TARGET = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const THIRD = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const TAG = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const payee = (id: string, name: string, updatedAt = '2026-10-10T00:00:00.000Z') => ({
  id,
  name,
  updatedAt: new Date(updatedAt),
  toJSON: () => ({ id, name }),
});

const run = ({
  resolver,
  toolName,
  args,
}: {
  resolver: PreviewResolver;
  toolName: string;
  args: Record<string, unknown>;
}) => resolver({ userId: USER, toolName, args, policy: resolveToolPolicy({ name: toolName, args })! });

describe('payee previews', () => {
  beforeEach(() => {
    jest.mocked(transactionsQuery.countTransactions).mockReset().mockResolvedValue(0);
    jest
      .mocked(transactionsQuery.findTransactions)
      .mockReset()
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('merge_payees', () => {
    const merge = () =>
      run({ resolver: resolveMergePayees, toolName: 'merge_payees', args: { sourceId: SOURCE, targetId: TARGET } });

    it('lists the source and the transactions and aliases that move', async () => {
      const find = jest
        .spyOn(Payees, 'findOne')
        .mockResolvedValueOnce(payee(SOURCE, 'AMZN MKT', '2026-10-12T00:00:00.000Z') as never)
        .mockResolvedValueOnce(payee(TARGET, 'Amazon') as never);
      jest.spyOn(PayeeAliases, 'count').mockResolvedValue(2);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(30);

      const { preview, affectedCount, snapshot } = await merge();

      expect(find.mock.calls.map((call) => (call[0] as any).where)).toEqual([
        { id: SOURCE, userId: USER },
        { id: TARGET, userId: USER },
      ]);
      expect(jest.mocked(transactionsQuery.countTransactions).mock.calls[0]![0]).toMatchObject({
        where: { payeeId: SOURCE },
      });
      expect(preview.counts).toEqual({ transactionCount: 30, aliasCount: 2 });
      expect(preview.affected).toMatchObject({
        count: 32,
        truncated: false,
        rows: [{ payee: { kind: 'payee', id: SOURCE }, transactions: 30, aliases: 2 }],
      });
      expect(affectedCount).toBe(32);
      expect(snapshot).toEqual({
        updatedAt: '2026-10-12T00:00:00.000Z',
        targetHash: hashTargetIds({ ids: [SOURCE, TARGET] }),
        targetCount: 2,
      });
    });

    it('refuses a payee that is not there, and a merge into itself', async () => {
      jest.spyOn(Payees, 'findOne').mockResolvedValue(null);
      await expect(merge()).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });

      await expect(
        run({ resolver: resolveMergePayees, toolName: 'merge_payees', args: { sourceId: SOURCE, targetId: SOURCE } }),
      ).rejects.toBeInstanceOf(PreviewError);
    });

    it('refuses a pending proposal as source or target', async () => {
      await expect(
        run({
          resolver: resolveMergePayees,
          toolName: 'merge_payees',
          args: { sourceId: `$proposal:${THIRD}`, targetId: TARGET },
        }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.targetIsProposal' });
    });
  });

  describe('bulk_delete_payees', () => {
    it('lists the payees with their transaction and alias counts', async () => {
      jest
        .spyOn(Payees, 'findAll')
        .mockResolvedValue([payee(SOURCE, 'A'), payee(TARGET, 'B', '2026-10-15T00:00:00.000Z')] as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([
        { payeeId: SOURCE, count: '5' },
        { payeeId: TARGET, count: '1' },
      ] as never);
      jest.spyOn(PayeeAliases, 'findAll').mockResolvedValue([{ payeeId: SOURCE, count: '2' }] as never);

      const { preview, affectedCount, snapshot, warnings } = await run({
        resolver: resolveBulkDeletePayees,
        toolName: 'bulk_delete_payees',
        args: { ids: [SOURCE, TARGET] },
      });

      // The delete unlinks every row that carries the payee, whoever wrote it, so the count follows account access.
      expect(jest.mocked(transactionsQuery.findTransactions).mock.calls[0]![0]).toMatchObject({
        access: { accessibleTo: USER },
      });
      expect(preview.counts).toEqual({ transactionCount: 6, aliasCount: 2 });
      expect(preview.affected!.rows).toEqual([
        { payee: { kind: 'payee', id: SOURCE }, transactions: 5, aliases: 2 },
        { payee: { kind: 'payee', id: TARGET }, transactions: 1, aliases: 0 },
      ]);
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(affectedCount).toBe(2);
      expect(snapshot).toMatchObject({ updatedAt: '2026-10-15T00:00:00.000Z', targetCount: 2 });
      expect(warnings).toBeUndefined();
    });

    it('refuses the whole call when one id is not the user payee, as the service does', async () => {
      jest.spyOn(Payees, 'findAll').mockResolvedValue([payee(SOURCE, 'A')] as never);

      await expect(
        run({ resolver: resolveBulkDeletePayees, toolName: 'bulk_delete_payees', args: { ids: [SOURCE, TARGET] } }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });

    it('warns that the names are ignored from now on', async () => {
      jest.spyOn(Payees, 'findAll').mockResolvedValue([payee(SOURCE, 'A')] as never);
      jest.spyOn(PayeeAliases, 'findAll').mockResolvedValue([] as never);

      const { warnings } = await run({
        resolver: resolveBulkDeletePayees,
        toolName: 'bulk_delete_payees',
        args: { ids: [SOURCE], ignoreFuture: true },
      });

      expect(warnings).toEqual([{ key: 'chat.warnings.payeesIgnored' }]);
    });

    it('shows at most 10 rows but counts them all', async () => {
      const ids = Array.from({ length: 12 }, (_, n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`);
      jest.spyOn(Payees, 'findAll').mockResolvedValue(ids.map((id) => payee(id, id)) as never);
      jest.spyOn(PayeeAliases, 'findAll').mockResolvedValue([] as never);

      const { preview, affectedCount } = await run({
        resolver: resolveBulkDeletePayees,
        toolName: 'bulk_delete_payees',
        args: { ids },
      });

      expect(preview.affected!.rows).toHaveLength(10);
      expect(preview.affected).toMatchObject({ count: 12, truncated: true });
      expect(affectedCount).toBe(12);
    });
  });

  describe('ignore_payee_name', () => {
    beforeEach(() => {
      jest.mocked(parsePayeeName).mockReset().mockReturnValue({ display: 'ACME', normalized: 'acme' });
      jest.mocked(resolveNormalizedName).mockReset().mockResolvedValue(null);
      jest.spyOn(PayeeIgnoredNames, 'findOne').mockResolvedValue(null);
    });

    const ignore = ({ force }: { force?: boolean }) =>
      run({
        resolver: resolveIgnorePayeeName,
        toolName: 'ignore_payee_name',
        args: { rawName: 'ACME', ...(force ? { force } : {}) },
      });

    it('shows no payee when the name resolves to none', async () => {
      const { preview, affectedCount } = await ignore({});

      expect(preview.before).toBeNull();
      expect(affectedCount).toBeUndefined();
      expect(parsePayeeName).toHaveBeenCalledWith({ raw: 'ACME', emptyMessageKey: 'payees.nameRequired' });
    });

    it('refuses a name that still resolves to a payee, as the service does without force', async () => {
      jest.mocked(resolveNormalizedName).mockResolvedValue({ payeeId: SOURCE, name: 'Acme Inc', via: 'canonical' });

      await expect(ignore({})).rejects.toMatchObject({ messageKey: 'chat.cards.ignoredNameCollides' });
    });

    it('turns red with force and shows the payee that is deleted and what loses its payee', async () => {
      jest.mocked(resolveNormalizedName).mockResolvedValue({ payeeId: SOURCE, name: 'Acme Inc', via: 'canonical' });
      jest.spyOn(Payees, 'findOne').mockResolvedValue(payee(SOURCE, 'Acme Inc') as never);
      jest.spyOn(PayeeAliases, 'count').mockResolvedValue(1);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(8);

      const { preview, affectedCount, snapshot } = await ignore({ force: true });

      expect(resolveToolPolicy({ name: 'ignore_payee_name', args: { rawName: 'ACME', force: true } })!.danger).toBe(
        'destructive',
      );
      expect(preview.before).toEqual({ id: SOURCE, name: 'Acme Inc' });
      expect(jest.mocked(transactionsQuery.countTransactions).mock.calls[0]![0]).toMatchObject({
        access: { accessibleTo: USER },
        where: { payeeId: SOURCE },
      });
      expect(preview.counts).toEqual({ transactionCount: 8, aliasCount: 1 });
      expect(affectedCount).toBe(9);
      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [SOURCE] }), targetCount: 1 });
    });

    it('notes a name that is already on the ignore list', async () => {
      jest.spyOn(PayeeIgnoredNames, 'findOne').mockResolvedValue({ id: 'x' } as never);

      const { warnings } = await ignore({});

      expect(warnings).toEqual([{ key: 'chat.warnings.alreadyIgnored' }]);
    });

    it('snapshots an empty target set when no payee matches, so a payee that appears later makes the card stale', async () => {
      const { snapshot: stored } = await ignore({ force: true });

      expect(stored).toMatchObject({ targetHash: hashTargetIds({ ids: [] }), targetCount: 0 });

      jest.mocked(resolveNormalizedName).mockResolvedValue({ payeeId: SOURCE, name: 'Acme Inc', via: 'canonical' });
      jest.spyOn(Payees, 'findOne').mockResolvedValue(payee(SOURCE, 'Acme Inc') as never);
      jest.spyOn(PayeeAliases, 'count').mockResolvedValue(0);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(3);
      const { snapshot: current } = await ignore({ force: true });

      expect(
        compareSnapshots({
          stored: { baseCurrencyCode: 'USD', ...stored },
          current: { baseCurrencyCode: 'USD', ...current },
        }),
      ).toMatchObject({ stale: true, reasonKey: 'chat.stale.targets', before: 0, after: 1 });
    });

    it('snapshots an empty target set for a name that is already ignored', async () => {
      jest.spyOn(PayeeIgnoredNames, 'findOne').mockResolvedValue({ id: 'x' } as never);

      const { snapshot } = await ignore({});

      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [] }), targetCount: 0 });
    });
  });

  describe('apply_payee_tags_to_transactions', () => {
    it('shows the payee, its default tags and how many transactions get them', async () => {
      jest.spyOn(Payees, 'findOne').mockResolvedValue({
        ...payee(SOURCE, 'Amazon'),
        defaultTags: [{ id: TAG }, { id: THIRD }],
      } as never);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(120);

      const { preview, snapshot, warnings } = await run({
        resolver: resolveApplyPayeeTags,
        toolName: 'apply_payee_tags_to_transactions',
        args: { payeeId: SOURCE },
      });

      expect(preview.before).toMatchObject({ name: 'Amazon' });
      expect(preview.counts).toEqual({ transactionCount: 120, tagCount: 2 });
      expect(jest.mocked(transactionsQuery.countTransactions).mock.calls[0]![0]).toMatchObject({
        where: { payeeId: SOURCE },
      });
      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [SOURCE] }), targetCount: 1 });
      expect(warnings).toBeUndefined();
    });

    it('warns when the payee has no default tags, and refuses a payee that is not there', async () => {
      jest.spyOn(Payees, 'findOne').mockResolvedValue({ ...payee(SOURCE, 'Amazon'), defaultTags: [] } as never);
      const { warnings } = await run({
        resolver: resolveApplyPayeeTags,
        toolName: 'apply_payee_tags_to_transactions',
        args: { payeeId: SOURCE },
      });
      expect(warnings).toEqual([{ key: 'chat.warnings.noDefaultTags' }]);

      jest.spyOn(Payees, 'findOne').mockResolvedValue(null);
      await expect(
        run({
          resolver: resolveApplyPayeeTags,
          toolName: 'apply_payee_tags_to_transactions',
          args: { payeeId: SOURCE },
        }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });
  });
});
