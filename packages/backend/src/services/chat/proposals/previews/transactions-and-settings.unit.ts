import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import { namespace } from '@models/connection';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import TransactionAutomations from '@models/transaction-automations.model';
import * as transactionsModel from '@models/transactions.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import * as usersCurrencies from '@models/users-currencies.model';
import { Op } from 'sequelize';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findTransactions: jest.fn(),
  countTransactions: jest.fn(),
  findOneTransaction: jest.fn(),
}));
jest.mock('@services/transaction-automations/preview', () => ({ scanAutomationMatches: jest.fn() }));
jest.mock('@services/sharing/auth/get-accessible-account-ids.service', () => ({
  getAccessibleAccountIdsForUser: jest.fn(),
}));

import * as transactionsQuery from '@models/transactions-query';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';
import { scanAutomationMatches } from '@services/transaction-automations/preview';

import { resolveToolPolicy } from '../../policies';
import { hashTargetIds } from '../snapshot';
import { resolveApplyTransactionAutomation } from './automation-apply';
import { resolveBudgetPlanAssignment } from './budget-plan-assignment';
import { resolveChangeBaseCurrency } from './change-base-currency';
import { resolveDeleteExchangeRates } from './exchange-rates';
import { resolveDeleteImportBatch } from './import-batch';
import { PreviewError } from './preview-helpers';
import { resolveMergeDuplicateTransactions, resolveRemoveDuplicateTransactions } from './reconciliation';
import { resolveRevertSubscriptionPeriod } from './revert-subscription-period';
import type { PreviewResolver } from './types';

const USER = 7;
const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const OTHER_ACCOUNT = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const tx = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(n),
  time: new Date(Date.UTC(2026, 9, n)),
  accountId: ACCOUNT,
  transactionType: TRANSACTION_TYPES.expense,
  amount: Money.fromDecimal(10 * n),
  currencyCode: 'USD',
  categoryId: null,
  payeeId: null,
  note: '',
  transferId: null,
  isPlanned: false,
  refundLinked: false,
  updatedAt: new Date(Date.UTC(2026, 9, 10 + n)),
  toJSON() {
    return { id: this.id, note: 'kept' };
  },
  ...overrides,
});

const run = ({
  resolver,
  toolName,
  args,
  lock,
}: {
  resolver: PreviewResolver;
  toolName: string;
  args: Record<string, unknown>;
  lock?: boolean;
}) => resolver({ userId: USER, toolName, args, policy: resolveToolPolicy({ name: toolName, args })!, lock });

describe('transaction and settings previews', () => {
  beforeEach(() => {
    jest.mocked(transactionsQuery.countTransactions).mockReset().mockResolvedValue(0);
    jest
      .mocked(transactionsQuery.findTransactions)
      .mockReset()
      .mockResolvedValue([] as never);
    jest.mocked(transactionsQuery.findOneTransaction).mockReset().mockResolvedValue(null);
    jest.mocked(scanAutomationMatches).mockReset();
    jest.mocked(getAccessibleAccountIdsForUser).mockReset().mockResolvedValue([ACCOUNT]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('duplicate removal and merging', () => {
    it('lists the transactions a removal takes off the books, with their count', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1), tx(2)] as never);

      const { preview, affectedCount, snapshot } = await run({
        resolver: resolveRemoveDuplicateTransactions,
        toolName: 'remove_duplicate_transactions',
        args: { transactionIds: [uuid(1), uuid(2)] },
      });

      expect(affectedCount).toBe(2);
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [uuid(1), uuid(2)] }), targetCount: 2 });
    });

    it('refuses rows the service refuses: planned, transfer and refund-linked ones', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1), tx(2, { isPlanned: true })] as never);

      await expect(
        run({
          resolver: resolveRemoveDuplicateTransactions,
          toolName: 'remove_duplicate_transactions',
          args: { transactionIds: [uuid(1), uuid(2)] },
        }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.reconciliationRefused' });

      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1, { transferId: uuid(9) })] as never);
      await expect(
        run({
          resolver: resolveRemoveDuplicateTransactions,
          toolName: 'remove_duplicate_transactions',
          args: { transactionIds: [uuid(1)] },
        }),
      ).rejects.toBeInstanceOf(PreviewError);

      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1, { refundLinked: true })] as never);
      await expect(
        run({
          resolver: resolveRemoveDuplicateTransactions,
          toolName: 'remove_duplicate_transactions',
          args: { transactionIds: [uuid(1)] },
        }),
      ).rejects.toBeInstanceOf(PreviewError);
    });

    it('counts a duplicate on an account the user can no longer see but shows none of its details', async () => {
      jest
        .mocked(transactionsQuery.findTransactions)
        .mockResolvedValue([tx(1), tx(2, { accountId: OTHER_ACCOUNT })] as never);

      const { preview, affectedCount } = await run({
        resolver: resolveRemoveDuplicateTransactions,
        toolName: 'remove_duplicate_transactions',
        args: { transactionIds: [uuid(1), uuid(2)] },
      });

      expect(affectedCount).toBe(2);
      expect(preview.affected!.count).toBe(2);
      expect(preview.affected!.rows.map((row) => (row.account as { id: string }).id)).toEqual([ACCOUNT]);
    });

    it('does not show a survivor on an account the user cannot see', async () => {
      jest
        .mocked(transactionsQuery.findTransactions)
        .mockResolvedValue([tx(1), tx(2, { accountId: OTHER_ACCOUNT })] as never);

      const { preview, affectedCount } = await run({
        resolver: resolveMergeDuplicateTransactions,
        toolName: 'merge_duplicate_transactions',
        args: { transactionIds: [uuid(1), uuid(2)], survivorId: uuid(2) },
      });

      expect(preview.before).toBeUndefined();
      expect(affectedCount).toBe(1);
    });

    it('refuses ids that are not the user transactions', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1)] as never);

      await expect(
        run({
          resolver: resolveRemoveDuplicateTransactions,
          toolName: 'remove_duplicate_transactions',
          args: { transactionIds: [uuid(1), uuid(2)] },
        }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });

    it('shows the survivor as it stays and lists only the rows a merge removes', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1), tx(2), tx(3)] as never);

      const { preview, affectedCount, snapshot } = await run({
        resolver: resolveMergeDuplicateTransactions,
        toolName: 'merge_duplicate_transactions',
        args: { transactionIds: [uuid(1), uuid(2), uuid(3)], survivorId: uuid(2) },
      });

      expect(preview.before).toEqual({ id: uuid(2), note: 'kept' });
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(preview.affected!.rows.map((row) => row.amount)).toEqual([10, 30]);
      expect(affectedCount).toBe(2);
      expect(snapshot).toMatchObject({
        targetCount: 3,
        targetHash: hashTargetIds({ ids: [uuid(1), uuid(2), uuid(3)] }),
      });
    });
  });

  describe('delete_import_batch', () => {
    const batch = { id: 'row-1', batchId: 'batch-1', finishedAt: new Date('2026-10-01T00:00:00Z'), toJSON: () => ({}) };
    const remove = (extra: Record<string, unknown> = {}) =>
      run({
        resolver: resolveDeleteImportBatch,
        toolName: 'delete_import_batch',
        args: { batchId: 'batch-1', ...extra },
      });

    it('lists the transactions of the batch and the accounts and balances the undo touches', async () => {
      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue(batch as never);
      jest.spyOn(ImportBatchAccountEffects, 'findAll').mockResolvedValue([
        { createdByImport: true, absorbedAmount: Money.fromDecimal(0) },
        { createdByImport: false, absorbedAmount: Money.fromDecimal(50) },
      ] as never);
      const find = jest.spyOn(transactionsModel, 'findWithFilters').mockResolvedValue([tx(1), tx(2)] as never);

      const { preview, affectedCount, snapshot } = await remove();

      expect(find.mock.calls[0]![0]).toMatchObject({
        batchId: 'batch-1',
        access: { creator: USER },
        planned: 'exclude',
      });
      expect(preview.counts).toEqual({ transactionCount: 2, createdAccountCount: 1, balanceReversalCount: 1 });
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(affectedCount).toBe(2);
      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [uuid(1), uuid(2)] }), targetCount: 2 });
    });

    const TWO_LEG = TRANSACTION_TRANSFER_NATURE.common_transfer;
    const linked = (n: number, overrides: Record<string, unknown> = {}) =>
      tx(n, { transferId: uuid(50), transferNature: TWO_LEG, ...overrides });

    it('counts the outside leg of a transfer only when the undo deletes it', async () => {
      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue(batch as never);
      jest.spyOn(ImportBatchAccountEffects, 'findAll').mockResolvedValue([] as never);
      jest.spyOn(transactionsModel, 'findWithFilters').mockResolvedValue([linked(1)] as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([linked(2)] as never);

      const kept = await remove();
      const deleted = await remove({ deleteLinkedTransfers: true });

      expect(kept.affectedCount).toBe(1);
      expect(kept.warnings).toBeUndefined();
      expect(deleted.affectedCount).toBe(2);
      expect(deleted.warnings).toEqual([{ key: 'chat.warnings.linkedTransfers', params: { count: 1 } }]);
    });

    it('finds the outside legs the way the service does, whoever created them', async () => {
      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue(batch as never);
      jest.spyOn(ImportBatchAccountEffects, 'findAll').mockResolvedValue([] as never);
      jest
        .spyOn(transactionsModel, 'findWithFilters')
        .mockResolvedValue([
          linked(1),
          tx(3, { transferId: uuid(51), transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio }),
        ] as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([linked(2)] as never);

      await remove({ deleteLinkedTransfers: true });

      expect(transactionsQuery.findTransactions).toHaveBeenCalledTimes(1);
      expect(jest.mocked(transactionsQuery.findTransactions).mock.calls[0]![0]).toMatchObject({
        access: 'unscoped-internal',
        where: { transferId: [uuid(50)] },
      });
    });

    it('counts an outside leg on an account the user cannot see, shows none of its details, and snapshots it', async () => {
      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue(batch as never);
      jest.spyOn(ImportBatchAccountEffects, 'findAll').mockResolvedValue([] as never);
      jest.spyOn(transactionsModel, 'findWithFilters').mockResolvedValue([linked(1)] as never);
      const hidden = linked(2, { accountId: OTHER_ACCOUNT, updatedAt: new Date('2026-10-17T00:00:00Z') });
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([hidden] as never);

      const { preview, affectedCount, warnings, snapshot } = await remove({ deleteLinkedTransfers: true });

      expect(affectedCount).toBe(2);
      expect(preview.affected!.count).toBe(2);
      expect(preview.affected!.rows.map((row) => (row.account as { id: string }).id)).toEqual([ACCOUNT]);
      expect(warnings).toEqual([{ key: 'chat.warnings.linkedTransfers', params: { count: 1 } }]);
      expect(snapshot).toMatchObject({
        targetHash: hashTargetIds({ ids: [uuid(1), uuid(2)] }),
        targetCount: 2,
        updatedAt: '2026-10-17T00:00:00.000Z',
      });
    });

    it('snapshots an outside leg the undo unlinks, so one linked later makes the card stale', async () => {
      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue(batch as never);
      jest.spyOn(ImportBatchAccountEffects, 'findAll').mockResolvedValue([] as never);
      jest.spyOn(transactionsModel, 'findWithFilters').mockResolvedValue([linked(1)] as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([linked(2)] as never);

      const { affectedCount, snapshot } = await remove();

      expect(affectedCount).toBe(1);
      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [uuid(1), uuid(2)] }), targetCount: 2 });
    });

    it('warns about an import that is still running, and refuses a batch that is not there', async () => {
      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue({ ...batch, finishedAt: null } as never);
      jest.spyOn(ImportBatchAccountEffects, 'findAll').mockResolvedValue([] as never);
      jest.spyOn(transactionsModel, 'findWithFilters').mockResolvedValue([tx(1)] as never);

      expect((await remove()).warnings).toEqual([{ key: 'chat.warnings.importRunning' }]);

      jest.spyOn(ImportBatches, 'findOne').mockResolvedValue(null);
      jest.spyOn(transactionsModel, 'findWithFilters').mockResolvedValue([] as never);
      await expect(remove()).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });
  });

  describe('change_base_currency', () => {
    const change = () =>
      run({ resolver: resolveChangeBaseCurrency, toolName: 'change_base_currency', args: { newCurrencyCode: 'EUR' } });

    it('counts the accounts and rows the change revalues, and warns that edits are blocked meanwhile', async () => {
      jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'USD' } as never);
      const accounts = jest.spyOn(Accounts, 'count').mockResolvedValue(3);
      jest.mocked(transactionsQuery.countTransactions).mockResolvedValue(900);

      const { preview, affectedCount, warnings } = await change();

      expect(accounts.mock.calls[0]![0]).toMatchObject({ where: { userId: USER } });
      expect(preview.before).toEqual({ baseCurrencyCode: 'USD' });
      expect(preview.counts).toEqual({ accountCount: 3, transactionCount: 900 });
      expect(affectedCount).toBe(903);
      expect(warnings).toEqual([{ key: 'chat.warnings.baseCurrencyBlocksEdits' }]);
    });

    it('sets a first base currency at once: nothing to revalue, a plain confirmation', async () => {
      jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue(null as never);

      const { preview, affectedCount, warnings } = await change();

      expect(preview.before).toEqual({ baseCurrencyCode: null });
      expect(affectedCount).toBeUndefined();
      expect(warnings).toBeUndefined();
    });

    it('refuses the currency that is already the base', async () => {
      jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'EUR' } as never);

      await expect(change()).rejects.toBeInstanceOf(PreviewError);
    });
  });

  describe('delete_exchange_rates', () => {
    it('lists the rates the removal takes away', async () => {
      const find = jest.spyOn(UserExchangeRates, 'findAll').mockResolvedValue([
        {
          baseCode: 'PTS',
          quoteCode: 'USD',
          effectiveDate: '2026-10-01',
          rate: 2,
          date: new Date('2026-10-02T00:00:00Z'),
        },
        {
          baseCode: 'USD',
          quoteCode: 'PTS',
          effectiveDate: '2026-10-01',
          rate: 0.5,
          date: new Date('2026-10-03T00:00:00Z'),
        },
      ] as never);

      const { preview, affectedCount, snapshot } = await run({
        resolver: resolveDeleteExchangeRates,
        toolName: 'delete_exchange_rates',
        args: {
          pairs: [
            { baseCode: 'PTS', quoteCode: 'USD', effectiveDate: '2026-10-01' },
            { baseCode: 'USD', quoteCode: 'PTS', effectiveDate: '2026-10-01' },
          ],
        },
      });

      expect((find.mock.calls[0]![0] as any).where[Op.or]).toEqual([
        { userId: USER, baseCode: 'PTS', quoteCode: 'USD', effectiveDate: '2026-10-01' },
        { userId: USER, baseCode: 'USD', quoteCode: 'PTS', effectiveDate: '2026-10-01' },
      ]);
      expect((find.mock.calls[0]![0] as any).raw).toBe(true);
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(preview.affected!.rows[0]).toEqual({
        pair: 'PTS/USD',
        effectiveDate: '2026-10-01',
        rate: 2,
        source: null,
      });
      expect(affectedCount).toBe(2);
      expect(snapshot.targetCount).toBe(2);
      expect(snapshot.updatedAt).toBe('2026-10-03T00:00:00.000Z');
    });

    it('refuses pairs the user has no rate for', async () => {
      jest.spyOn(UserExchangeRates, 'findAll').mockResolvedValue([] as never);

      await expect(
        run({
          resolver: resolveDeleteExchangeRates,
          toolName: 'delete_exchange_rates',
          args: {
            pairs: [
              { baseCode: 'PTS', quoteCode: 'USD' },
              { baseCode: 'USD', quoteCode: 'PTS' },
            ],
          },
        }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.noTargets' });
    });
  });

  describe('apply_transaction_automation', () => {
    const rule = {
      id: uuid(80),
      name: 'Coffee',
      conditions: { match: 'all', items: [] },
      updatedAt: new Date('2026-10-05T00:00:00Z'),
    };
    const apply = () =>
      run({
        resolver: resolveApplyTransactionAutomation,
        toolName: 'apply_transaction_automation',
        args: { automationId: rule.id, transactionIds: [uuid(1), uuid(2), uuid(3)] },
      });

    it('lists the rows the rule matches among the given ids and warns about the ones it skips', async () => {
      const find = jest.spyOn(TransactionAutomations, 'findOne').mockResolvedValue(rule as never);
      jest.mocked(scanAutomationMatches).mockResolvedValue({ rows: [tx(1), tx(2)], scannedCount: 3 } as never);

      const { preview, affectedCount, warnings, snapshot } = await apply();

      expect((find.mock.calls[0]![0] as any).where).toEqual({ id: rule.id, userId: USER });
      expect(jest.mocked(scanAutomationMatches).mock.calls[0]![0]).toMatchObject({
        userId: USER,
        conditions: rule.conditions,
        transactionIds: [uuid(1), uuid(2), uuid(3)],
      });
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(preview.counts).toEqual({ matchedCount: 2, skippedCount: 1 });
      expect(affectedCount).toBe(2);
      expect(warnings).toEqual([{ key: 'chat.warnings.automationSkipped', params: { count: 1 } }]);
      expect(snapshot).toMatchObject({ targetHash: hashTargetIds({ ids: [uuid(1), uuid(2)] }), targetCount: 2 });
      expect(snapshot.updatedAt).toBe(new Date(Date.UTC(2026, 9, 12)).toISOString());
    });

    it('refuses a rule that is not there', async () => {
      jest.spyOn(TransactionAutomations, 'findOne').mockResolvedValue(null);

      await expect(apply()).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });
  });

  describe('revert_subscription_period', () => {
    const args = { subscriptionId: uuid(60), periodId: uuid(61) };
    const period = (overrides: Record<string, unknown> = {}) => ({
      id: uuid(61),
      status: 'paid',
      transactionId: uuid(1),
      transactionAutoCreated: true,
      updatedAt: new Date('2026-10-05T00:00:00Z'),
      toJSON: () => ({ id: uuid(61), status: 'paid' }),
      ...overrides,
    });
    const revert = () =>
      run({ resolver: resolveRevertSubscriptionPeriod, toolName: 'revert_subscription_period', args });

    beforeEach(() => {
      jest.spyOn(Subscriptions, 'findOne').mockResolvedValue({ id: uuid(60) } as never);
    });

    it('shows the period and the payment transaction the revert deletes', async () => {
      jest.spyOn(SubscriptionPeriods, 'findOne').mockResolvedValue(period() as never);
      jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(tx(1) as never);
      jest.spyOn(Accounts, 'findByPk').mockResolvedValue({ type: 'system' } as never);

      const { preview, affectedCount, warnings, snapshot } = await revert();

      expect(preview.before).toEqual({ id: uuid(61), status: 'paid' });
      // The revert deletes the payment through the share-aware service, so the lookup follows account access.
      expect(jest.mocked(transactionsQuery.findOneTransaction).mock.calls[0]![0]).toMatchObject({
        access: { accessibleTo: USER },
      });
      expect(preview.affected).toMatchObject({ count: 1 });
      expect(affectedCount).toBe(2);
      expect(warnings).toEqual([{ key: 'chat.warnings.revertDeletesTransaction' }]);
      expect(snapshot).toMatchObject({ targetCount: 2 });
    });

    it('keeps a transaction the user linked, and shows no deleted row', async () => {
      jest.spyOn(SubscriptionPeriods, 'findOne').mockResolvedValue(period({ transactionAutoCreated: false }) as never);

      const { preview, affectedCount, warnings } = await revert();

      expect(preview.affected).toBeUndefined();
      expect(affectedCount).toBe(1);
      expect(warnings).toBeUndefined();
      expect(transactionsQuery.findOneTransaction).not.toHaveBeenCalled();
    });

    it('keeps a booked transaction on a bank-linked account', async () => {
      jest.spyOn(SubscriptionPeriods, 'findOne').mockResolvedValue(period() as never);
      jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue(tx(1) as never);
      jest.spyOn(Accounts, 'findByPk').mockResolvedValue({ type: 'monobank' } as never);

      const { preview, affectedCount } = await revert();

      expect(preview.affected).toBeUndefined();
      expect(affectedCount).toBe(1);
    });

    it('refuses a period that is already open, and one that is not there', async () => {
      jest.spyOn(SubscriptionPeriods, 'findOne').mockResolvedValue(period({ status: 'upcoming' }) as never);
      await expect(revert()).rejects.toBeInstanceOf(PreviewError);

      jest.spyOn(SubscriptionPeriods, 'findOne').mockResolvedValue(null);
      await expect(revert()).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });
  });

  describe('set_budget_plan_assignment', () => {
    const args = { planId: uuid(70), periodId: uuid(71), lineId: uuid(72), scope: 'this_period', amount: 250 };
    const assign = (override: Record<string, unknown> = {}) =>
      run({
        resolver: resolveBudgetPlanAssignment,
        toolName: 'set_budget_plan_assignment',
        args: { ...args, ...override },
      });

    beforeEach(() => {
      jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue({ id: uuid(70), currencyCode: 'USD' } as never);
      jest.spyOn(BudgetLines, 'findOne').mockResolvedValue({ id: uuid(72), name: 'Food' } as never);
    });

    it('shows the amount and carry policy in force for the scope and the line it is for', async () => {
      const find = jest.spyOn(BudgetAssignments, 'findOne').mockResolvedValue({
        baselineAmount: Money.fromDecimal(200),
        overrideAmount: Money.fromDecimal(210),
        carryPolicy: 'floor',
        updatedAt: new Date('2026-10-06T00:00:00Z'),
      } as never);

      const { preview, snapshot } = await assign();

      expect((find.mock.calls[0]![0] as any).where).toEqual({ periodId: uuid(71), lineId: uuid(72) });
      expect(preview.before).toEqual({ amount: 210, carryPolicy: 'floor', lineName: 'Food', currencyCode: 'USD' });
      expect(snapshot).toEqual({
        updatedAt: '2026-10-06T00:00:00.000Z',
        targetHash: hashTargetIds({ ids: [uuid(70), uuid(71), uuid(72)] }),
        targetCount: 1,
      });
    });

    it('reads the baseline for the from_here scope, and nothing when nothing was assigned', async () => {
      jest.spyOn(BudgetAssignments, 'findOne').mockResolvedValue({
        baselineAmount: Money.fromDecimal(200),
        overrideAmount: null,
        carryPolicy: null,
        updatedAt: new Date('2026-10-06T00:00:00Z'),
      } as never);
      expect((await assign({ scope: 'from_here' })).preview.before).toMatchObject({ amount: 200, carryPolicy: null });

      jest.spyOn(BudgetAssignments, 'findOne').mockResolvedValue(null);
      const { preview, snapshot } = await assign();
      expect(preview.before).toMatchObject({ amount: null, carryPolicy: null });
      expect(snapshot.updatedAt).toBeNull();
    });

    it('takes the plan lock before the line and assignment locks, in the order the budget services lock', async () => {
      const plan = jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue({ id: uuid(70), currencyCode: 'USD' } as never);
      const line = jest.spyOn(BudgetLines, 'findOne').mockResolvedValue({ id: uuid(72), name: 'Food' } as never);
      const assignment = jest.spyOn(BudgetAssignments, 'findOne').mockResolvedValue(null);

      await namespace.runAndReturn(async () => {
        namespace.set('transaction', { LOCK: { NO_KEY_UPDATE: 'NO KEY UPDATE' } });
        await run({
          resolver: resolveBudgetPlanAssignment,
          toolName: 'set_budget_plan_assignment',
          args,
          lock: true,
        });
      });

      expect(plan.mock.calls[0]![0]).toMatchObject({ lock: 'NO KEY UPDATE' } as never);
      expect(line.mock.calls[0]![0]).toMatchObject({ lock: true });
      expect(assignment.mock.calls[0]![0]).toMatchObject({ lock: true });
      expect(plan.mock.invocationCallOrder[0]).toBeLessThan(line.mock.invocationCallOrder[0]!);
      expect(line.mock.invocationCallOrder[0]).toBeLessThan(assignment.mock.invocationCallOrder[0]!);
    });

    it('holds no row when not asked to lock', async () => {
      const plan = jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue({ id: uuid(70), currencyCode: 'USD' } as never);
      const line = jest.spyOn(BudgetLines, 'findOne').mockResolvedValue({ id: uuid(72), name: 'Food' } as never);
      jest.spyOn(BudgetAssignments, 'findOne').mockResolvedValue(null);

      await assign();

      expect((plan.mock.calls[0]![0] as any).lock).toBeUndefined();
      expect(line.mock.calls[0]![0]).not.toHaveProperty('lock');
    });

    it('refuses a plan or line that is not the user', async () => {
      jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue(null);
      await expect(assign()).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });

      jest.spyOn(BudgetPlans, 'findOne').mockResolvedValue({ id: uuid(70), currencyCode: 'USD' } as never);
      jest.spyOn(BudgetLines, 'findOne').mockResolvedValue(null);
      await expect(assign()).rejects.toMatchObject({ messageKey: 'chat.cards.targetNotFound' });
    });
  });
});
