import { goalDisplayStatus, toGoalCurrency } from '@bt/shared/goals/goal-math';
import type {
  ChatCardAffected,
  ChatCardWarning,
  ChatGoalProgress,
  GoalInsights,
  GoalAccountShare,
  GoalAccountShareInput,
  GoalStatus,
  RecordId,
} from '@bt/shared/types';
import { centsToApiDecimal, centsToApiDecimalOrNull, Money } from '@common/types/money';
import Accounts from '@models/accounts.model';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { type GoalForInsights, loadGoalInsights, loadHeldFixedAmounts } from '@services/goals/goal-insights';
import { Op } from 'sequelize';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { assertConcreteTargets, forUpdate, PreviewError, SAMPLE_ROW_LIMIT, targetNotFound } from './preview-helpers';
import type { PreviewResolver } from './types';

/** A goal as the call leaves it: the stored one with the arguments laid over it. */
interface GoalState {
  name: string;
  currencyCode: string;
  targetAmount: number;
  targetDate: string | null;
  plannedMonthly: number | null;
  status: GoalStatus;
  accounts: GoalAccountShare[];
}

const AFFECTED_COLUMNS: ChatCardAffected['columns'] = [
  { key: 'account', label: 'chat.cards.columns.account', kind: 'entity' },
  { key: 'share', label: 'chat.cards.columns.sharePercent', kind: 'number' },
  { key: 'fixedAmount', label: 'chat.cards.columns.fixedAmount', kind: 'number' },
];

const stateOfStored = ({ goal, accounts }: { goal: Goals; accounts: GoalAccounts[] }): GoalState => ({
  name: goal.name,
  currencyCode: goal.currencyCode,
  targetAmount: centsToApiDecimal(goal.targetAmount),
  targetDate: goal.targetDate,
  plannedMonthly: centsToApiDecimalOrNull(goal.plannedMonthly),
  status: goal.status,
  accounts: accounts.map(({ accountId, sharePercent, fixedAmount, fixedPosition }) => ({
    accountId,
    sharePercent,
    fixedAmount: centsToApiDecimalOrNull(fixedAmount),
    fixedPosition,
  })),
});

const normalizeShare = ({
  accountId,
  sharePercent,
  fixedAmount,
  fixedPosition,
}: GoalAccountShareInput): GoalAccountShare => ({
  accountId,
  sharePercent: sharePercent ?? null,
  fixedAmount: fixedAmount ?? null,
  fixedPosition: fixedPosition ?? null,
});

/** The stored state with each argument the call gives laid over it; a create has nothing stored. */
const stateAfter = ({ stored, args }: { stored: GoalState | null; args: Record<string, unknown> }): GoalState => {
  const argAccounts = args.accounts as GoalAccountShareInput[] | undefined;

  return {
    name: (args.name as string | undefined) ?? stored?.name ?? '',
    currencyCode: (args.currencyCode as string | undefined) ?? stored?.currencyCode ?? '',
    targetAmount: (args.targetAmount as number | undefined) ?? stored?.targetAmount ?? 0,
    targetDate: args.targetDate !== undefined ? (args.targetDate as string | null) : (stored?.targetDate ?? null),
    plannedMonthly:
      args.plannedMonthly !== undefined ? (args.plannedMonthly as number | null) : (stored?.plannedMonthly ?? null),
    status: (args.status as GoalStatus | undefined) ?? stored?.status ?? 'active',
    accounts: argAccounts ? argAccounts.map(normalizeShare) : (stored?.accounts ?? []),
  };
};

const asInsightsGoal = ({ state, key }: { state: GoalState; key: string }): GoalForInsights => ({
  // Only the key the result is read back by; no goal row has it.
  id: key as RecordId,
  currencyCode: state.currencyCode,
  targetAmount: Money.fromDecimal(state.targetAmount),
  targetDate: state.targetDate,
  plannedMonthly: state.plannedMonthly === null ? null : Money.fromDecimal(state.plannedMonthly),
  goalAccounts: state.accounts.map(({ accountId, sharePercent, fixedAmount }) => ({
    accountId,
    sharePercent,
    fixedAmount: fixedAmount === null ? null : Money.fromDecimal(fixedAmount),
  })),
});

/**
 * The fixed amounts held on the state's accounts with the goal's own replaced by the state's: stored
 * ones leave, the state's go in under `key` at its `fixedPosition`, else the stored place, else last.
 */
const heldWith = ({
  held,
  goalId,
  key,
  state,
}: {
  held: GoalAccounts[];
  goalId: RecordId | null;
  key: string;
  state: GoalState;
}): Array<Pick<GoalAccounts, 'goalId' | 'accountId' | 'fixedAmount'>> => {
  const others = held.filter((row) => row.goalId !== goalId);
  if (state.status === 'archived') return others;

  const own = state.accounts.filter(({ fixedAmount }) => fixedAmount !== null);
  const placed = new Map(own.map((share) => [share.accountId, share]));

  return [...new Set([...others.map((row) => row.accountId), ...placed.keys()])].flatMap((accountId) => {
    const column = others.filter((row) => row.accountId === accountId);
    const share = placed.get(accountId);
    if (!share) return column;

    const onAccount = held.filter((row) => row.accountId === accountId);
    const storedIndex = onAccount.findIndex((row) => row.goalId === goalId);
    const position = Math.min(share.fixedPosition ?? (storedIndex === -1 ? column.length : storedIndex), column.length);
    const mine = { goalId: key as RecordId, accountId, fixedAmount: Money.fromDecimal(share.fixedAmount!) };

    return [...column.slice(0, position), mine, ...column.slice(position)];
  });
};

/**
 * Where each state stands: the linked accounts' shares valued today, against the target, in the goal
 * currency. One read of the accounts' history serves both states.
 */
const progressOf = async ({
  userId,
  goalId,
  states,
}: {
  userId: number;
  goalId: RecordId | null;
  states: Array<{ key: string; state: GoalState | null }>;
}): Promise<Map<string, ChatGoalProgress | null>> => {
  const present = states.filter((entry): entry is { key: string; state: GoalState } => entry.state !== null);
  const held = await loadHeldFixedAmounts({
    userId,
    accountIds: [...new Set(present.flatMap(({ state }) => state.accounts.map(({ accountId }) => accountId)))],
  });
  // The fixed amounts a state holds depend on its own accounts, so each state reads on its own.
  const insights = new Map<RecordId, GoalInsights | null>();
  for (const { key, state } of present) {
    const found = await loadGoalInsights({
      userId,
      goals: [asInsightsGoal({ state, key })],
      heldFixedAmounts: heldWith({ held, goalId, key, state }),
    });
    insights.set(key as RecordId, found.get(key as RecordId) ?? null);
  }

  return new Map(
    states.map(({ key, state }): [string, ChatGoalProgress | null] => {
      if (!state) return [key, null];

      const found = insights.get(key as RecordId) ?? null;
      const currentValue = found ? toGoalCurrency({ amount: found.currentValue, rateToBase: found.rateToBase }) : null;

      return [
        key,
        {
          currencyCode: state.currencyCode,
          targetAmount: state.targetAmount,
          currentValue,
          percent:
            currentValue === null || state.targetAmount <= 0
              ? null
              : Math.min(100, Math.round((currentValue / state.targetAmount) * 1000) / 10),
          status: goalDisplayStatus({ status: state.status, achievedAt: null, reachedHoldDays: 0, insights: found }),
        },
      ];
    }),
  );
};

/** The stored goal as a card's `before`: the scalar fields the arguments change; the accounts are the table. */
const beforeRowOf = ({ state }: { state: GoalState }): Record<string, unknown> => ({
  name: state.name,
  currencyCode: state.currencyCode,
  targetAmount: state.targetAmount,
  targetDate: state.targetDate,
  plannedMonthly: state.plannedMonthly,
  status: state.status,
});

const affectedOf = ({ accounts }: { accounts: GoalAccountShare[] }): ChatCardAffected => ({
  titleKey: 'chat.cards.affected.goalAccounts',
  count: accounts.length,
  columns: AFFECTED_COLUMNS,
  rows: accounts.slice(0, SAMPLE_ROW_LIMIT).map(({ accountId, sharePercent, fixedAmount }) => ({
    account: { kind: 'account' as const, id: accountId },
    share: sharePercent,
    fixedAmount,
  })),
  truncated: accounts.length > SAMPLE_ROW_LIMIT,
});

/** Throws for an account that is not the user's: the card names accounts, so an id it cannot name makes no card. */
const assertAccountsOwned = async ({ userId, accounts }: { userId: number; accounts: GoalAccountShare[] }) => {
  if (accounts.length === 0) return;

  const ids = accounts.map(({ accountId }) => accountId);
  const found = await Accounts.count({ where: { id: { [Op.in]: ids }, userId } });
  if (found !== new Set(ids).size) throw targetNotFound({ what: 'account' });
};

/**
 * The preview of the three goal calls. The card lists the goal as the call leaves it (a create, an
 * update) or as it goes (a delete) with its linked accounts and their shares, and shows the progress
 * against the target before and after. A delete takes the goal and its shares only: the accounts and
 * their transactions stay, so it asks for the single confirmation of a red card.
 */
export const resolveGoalCard: PreviewResolver = async ({ userId, toolName, args, lock }) => {
  const isCreate = toolName === 'create_goal';
  const isDelete = toolName === 'delete_goal';

  let goal: Goals | null = null;
  let stored: GoalState | null = null;
  if (!isCreate) {
    const goalId = args.goalId;
    assertConcreteTargets({ value: goalId, what: 'goal' });
    if (typeof goalId !== 'string') {
      throw new PreviewError({ messageKey: 'chat.cards.targetMissing', message: `${toolName} does not name its goal` });
    }

    goal = await Goals.findOne({ where: { id: goalId, userId }, ...forUpdate({ lock }) });
    if (!goal) throw targetNotFound({ what: 'goal' });

    const links = await GoalAccounts.findAll({
      where: { goalId },
      attributes: ['accountId', 'sharePercent', 'fixedAmount', 'fixedPosition'],
    });
    stored = stateOfStored({ goal, accounts: links });
  }

  const after = isDelete ? null : stateAfter({ stored, args });
  // Accounts the call names are checked; the stored ones were checked when they were linked.
  if (after && args.accounts !== undefined) await assertAccountsOwned({ userId, accounts: after.accounts });

  const progress = await progressOf({
    userId,
    goalId: goal?.id ?? null,
    states: [
      { key: 'before', state: stored },
      { key: 'after', state: after },
    ],
  });
  const unpriced = after !== null && progress.get('after')?.currentValue === null && after.accounts.length > 0;
  const shown = after ?? stored!;

  const warnings: ChatCardWarning[] = [
    ...(unpriced ? [{ key: 'chat.warnings.goalRateUnavailable', params: { currency: shown.currencyCode } }] : []),
    ...(after && stored && stored.status !== 'archived' && after.status === 'archived'
      ? [{ key: 'chat.warnings.goalArchiveFreesShares' }]
      : []),
  ];

  return {
    preview: {
      ...(stored ? { before: beforeRowOf({ state: stored }) } : {}),
      affected: affectedOf({ accounts: shown.accounts }),
      goalProgress: { before: progress.get('before') ?? null, after: progress.get('after') ?? null },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [goal?.updatedAt] }),
      targetHash: hashTargetIds({ ids: goal ? [goal.id] : [] }),
      targetCount: goal ? 1 : 0,
    },
    ...(isDelete ? { affectedCount: 1 } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};
