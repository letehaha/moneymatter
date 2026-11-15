import { Money } from '@common/types/money';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';

jest.mock('@services/goals/goal-insights', () => ({
  loadGoalInsights: jest.fn(),
  loadHeldFixedAmounts: jest.fn(async () => []),
}));

import { loadGoalInsights, loadHeldFixedAmounts } from '@services/goals/goal-insights';

import { resolveToolPolicy } from '../../policies';
import { resolveGoalCard } from './goal';
import { PreviewError } from './preview-helpers';

const USER = 7;
const GOAL = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const ACCOUNT_A = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const ACCOUNT_B = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';

const run = ({ toolName, args, lock }: { toolName: string; args: Record<string, unknown>; lock?: boolean }) =>
  resolveGoalCard({ userId: USER, toolName, args, lock, policy: resolveToolPolicy({ name: toolName, args })! });

const storedGoal = () =>
  ({
    id: GOAL,
    name: 'Holiday',
    currencyCode: 'EUR',
    targetAmount: Money.fromDecimal(2000),
    targetDate: '2027-06-01',
    plannedMonthly: null,
    status: 'active',
    updatedAt: new Date('2026-10-10T00:00:00.000Z'),
  }) as unknown as Goals;

/** Insights as `loadGoalInsights` returns them: base-currency amounts, 1 EUR = 2 base units. */
const insights = ({ currentValue, status = 'on_track' }: { currentValue: number; status?: string }) =>
  ({ currentValue, status, rateToBase: 2 }) as never;

const mockInsights = (byKey: Record<string, ReturnType<typeof insights> | null>) =>
  jest
    .mocked(loadGoalInsights)
    .mockImplementation(
      (async ({ goals }: { goals: Array<{ id: string }> }) =>
        new Map(goals.map((goal) => [goal.id, byKey[goal.id] ?? null]))) as never,
    );

const mockStored = ({
  accounts = [{ accountId: ACCOUNT_A, sharePercent: 100, fixedAmount: null, fixedPosition: null }],
} = {}) => {
  const find = jest.spyOn(Goals, 'findOne').mockResolvedValue(storedGoal() as never);
  jest.spyOn(GoalAccounts, 'findAll').mockResolvedValue(accounts as never);
  return find;
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(loadGoalInsights).mockReset();
  jest.mocked(loadHeldFixedAmounts).mockReset().mockResolvedValue([]);
});

describe('goalCard', () => {
  describe('create_goal', () => {
    const args = {
      name: 'Car',
      currencyCode: 'EUR',
      targetAmount: 5000,
      accounts: [
        { accountId: ACCOUNT_A, sharePercent: 60 },
        { accountId: ACCOUNT_B, sharePercent: 40 },
      ],
    };

    it('lists the linked accounts with their shares and the progress the goal starts at, with no before', async () => {
      jest.spyOn(Accounts, 'count').mockResolvedValue(2);
      mockInsights({ after: insights({ currentValue: 1000 }) });

      const { preview, snapshot, affectedCount } = await run({ toolName: 'create_goal', args });

      expect(preview.before).toBeUndefined();
      expect(preview.affected).toMatchObject({
        titleKey: 'chat.cards.affected.goalAccounts',
        count: 2,
        rows: [
          { account: { kind: 'account', id: ACCOUNT_A }, share: 60, fixedAmount: null },
          { account: { kind: 'account', id: ACCOUNT_B }, share: 40, fixedAmount: null },
        ],
      });
      expect(preview.goalProgress).toEqual({
        before: null,
        after: { currencyCode: 'EUR', targetAmount: 5000, currentValue: 500, percent: 10, status: 'on_track' },
      });
      expect(snapshot).toMatchObject({ targetCount: 0 });
      expect(affectedCount).toBeUndefined();
    });

    it('shows a fixed amount beside the shares and holds it in the account order for the insights', async () => {
      jest.spyOn(Accounts, 'count').mockResolvedValue(2);
      jest
        .mocked(loadHeldFixedAmounts)
        .mockResolvedValue([
          { goalId: 'other', accountId: ACCOUNT_A, fixedAmount: Money.fromDecimal(100), fixedPosition: 0 },
        ] as never);
      mockInsights({ after: insights({ currentValue: 1000 }) });

      const { preview } = await run({
        toolName: 'create_goal',
        args: {
          ...args,
          accounts: [
            { accountId: ACCOUNT_A, fixedAmount: 300, fixedPosition: 0 },
            { accountId: ACCOUNT_B, sharePercent: 40 },
          ],
        },
      });

      expect(preview.affected?.rows).toEqual([
        { account: { kind: 'account', id: ACCOUNT_A }, share: null, fixedAmount: 300 },
        { account: { kind: 'account', id: ACCOUNT_B }, share: 40, fixedAmount: null },
      ]);
      const { heldFixedAmounts } = jest.mocked(loadGoalInsights).mock.calls[0]![0];
      expect(heldFixedAmounts.map((row) => row.goalId)).toEqual(['after', 'other']);
    });

    it('warns when the goal currency has no rate, and shows no value', async () => {
      jest.spyOn(Accounts, 'count').mockResolvedValue(2);
      mockInsights({});

      const { preview, warnings } = await run({ toolName: 'create_goal', args });

      expect(preview.goalProgress?.after).toMatchObject({ currentValue: null, percent: null, status: 'no_rate' });
      expect(warnings).toEqual([{ key: 'chat.warnings.goalRateUnavailable', params: { currency: 'EUR' } }]);
    });

    it('refuses an account that is not the user’s', async () => {
      jest.spyOn(Accounts, 'count').mockResolvedValue(1);

      await expect(run({ toolName: 'create_goal', args })).rejects.toBeInstanceOf(PreviewError);
    });
  });

  describe('update_goal', () => {
    it('shows the goal as it is and its progress before and after the new target', async () => {
      mockStored();
      mockInsights({ before: insights({ currentValue: 1000 }), after: insights({ currentValue: 1000 }) });

      const { preview, snapshot, affectedCount } = await run({
        toolName: 'update_goal',
        args: { goalId: GOAL, targetAmount: 1000 },
      });

      expect(preview.before).toEqual({
        name: 'Holiday',
        currencyCode: 'EUR',
        targetAmount: 2000,
        targetDate: '2027-06-01',
        plannedMonthly: null,
        status: 'active',
      });
      expect(preview.goalProgress).toMatchObject({
        before: { targetAmount: 2000, currentValue: 500, percent: 25 },
        after: { targetAmount: 1000, currentValue: 500, percent: 50 },
      });
      expect(preview.affected?.rows).toEqual([
        { account: { kind: 'account', id: ACCOUNT_A }, share: 100, fixedAmount: null },
      ]);
      expect(snapshot).toMatchObject({ updatedAt: '2026-10-10T00:00:00.000Z', targetCount: 1 });
      expect(affectedCount).toBeUndefined();
    });

    it('lists the new accounts when the call replaces them', async () => {
      mockStored();
      jest.spyOn(Accounts, 'count').mockResolvedValue(1);
      mockInsights({});

      const { preview } = await run({
        toolName: 'update_goal',
        args: { goalId: GOAL, accounts: [{ accountId: ACCOUNT_B, sharePercent: 50 }] },
      });

      expect(preview.affected?.rows).toEqual([
        { account: { kind: 'account', id: ACCOUNT_B }, share: 50, fixedAmount: null },
      ]);
    });

    it('warns that archiving frees the shares', async () => {
      mockStored();
      mockInsights({ before: insights({ currentValue: 400 }), after: insights({ currentValue: 400 }) });

      const { warnings, preview } = await run({ toolName: 'update_goal', args: { goalId: GOAL, status: 'archived' } });

      expect(warnings).toEqual([{ key: 'chat.warnings.goalArchiveFreesShares' }]);
      expect(preview.goalProgress?.after?.status).toBe('archived');
    });

    it('holds the goal row under lock', async () => {
      const find = mockStored();
      mockInsights({});

      await run({ toolName: 'update_goal', args: { goalId: GOAL, name: 'Trip' }, lock: true });

      expect(find).toHaveBeenCalledWith(expect.objectContaining({ lock: true }));
    });

    it('refuses a goal that is not there, and a goal that is a pending proposal', async () => {
      jest.spyOn(Goals, 'findOne').mockResolvedValue(null);

      await expect(run({ toolName: 'update_goal', args: { goalId: GOAL } })).rejects.toBeInstanceOf(PreviewError);
      await expect(
        run({ toolName: 'update_goal', args: { goalId: '$proposal:3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11' } }),
      ).rejects.toMatchObject({ messageKey: 'chat.cards.targetIsProposal' });
    });
  });

  describe('delete_goal', () => {
    it('shows the goal that goes with its accounts and progress, and asks for the single confirmation', async () => {
      mockStored();
      mockInsights({ before: insights({ currentValue: 1000 }) });

      const { preview, affectedCount } = await run({ toolName: 'delete_goal', args: { goalId: GOAL } });

      expect(preview.before).toMatchObject({ name: 'Holiday', targetAmount: 2000 });
      expect(preview.goalProgress).toEqual({
        before: { currencyCode: 'EUR', targetAmount: 2000, currentValue: 500, percent: 25, status: 'on_track' },
        after: null,
      });
      expect(preview.affected?.count).toBe(1);
      expect(affectedCount).toBe(1);
    });

    it('is a red card with a confirm, not a typed one', () => {
      expect(resolveToolPolicy({ name: 'delete_goal', args: {} })).toMatchObject({
        kind: 'delete',
        danger: 'destructive',
        previewResolver: 'goalCard',
      });
    });
  });
});
