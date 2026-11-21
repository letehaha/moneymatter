import { useGoals } from '@/composable/data-queries/goals';
import { FULL_SHARE, computeGoalProgress, roundShare } from '@bt/shared/goals/goal-math';
import type {
  GoalAccountShare,
  GoalInsights,
  GoalMathInput,
  GoalModel,
  RecordId,
  UpdateGoalPayload,
} from '@bt/shared/types';
import { isEqual } from 'lodash-es';
import { type MaybeRefOrGetter, computed, ref, toValue, watch } from 'vue';

import { getAccountShareCapacity, toGoalCurrency } from '../helpers';

const SLIDER_STEPS = 100;
const SLIDER_HEADROOM = 2;
const FALLBACK_SLIDER_MAX = 1000;
const MONTHS_PER_YEAR = 12;

export interface GoalWhatIfEdits {
  /** Goal currency per month; null falls back to the historical pace. */
  monthly: number | null;
  /** 'yyyy-MM-dd'. */
  targetDate: string | null;
  /** Percent links only; fixed amounts aren't edited here. Empty input is null and counts as 0. */
  shares: Record<RecordId, number | null>;
}

export type GoalWhatIfApplyValues = Required<Pick<UpdateGoalPayload, 'plannedMonthly' | 'targetDate'>> & {
  accounts: GoalAccountShare[];
};

export type GoalWithInsights = GoalModel & { insights: GoalInsights };

/** The accounts with their edited share; a share of 0 or empty drops the account. Fixed amounts stay as they are. */
export const editedShares = <T extends Pick<GoalAccountShare, 'accountId' | 'fixedAmount'>>({
  accounts,
  shares,
}: {
  accounts: T[];
  shares: GoalWhatIfEdits['shares'];
}): T[] =>
  accounts.flatMap((account) => {
    if (account.fixedAmount !== null) return [account];
    const sharePercent = shares[account.accountId] ?? 0;
    return sharePercent > 0 ? [{ ...account, sharePercent }] : [];
  });

/** The server's math input with the sandbox edits applied. */
export const buildWhatIfInput = ({
  insights,
  plannedMonthly,
  edits,
}: {
  insights: Pick<GoalInsights, 'input' | 'rateToBase'>;
  plannedMonthly: number | null;
  edits: GoalWhatIfEdits;
}): GoalMathInput => {
  const { input, rateToBase } = insights;
  let baseMonthly: number | null = null;
  // The unchanged plan reuses the server's converted figure, so "now" and "what if" can't drift a cent apart.
  if (edits.monthly !== null)
    baseMonthly = edits.monthly === plannedMonthly ? input.plannedMonthly : edits.monthly * rateToBase;

  return {
    ...input,
    targetDate: edits.targetDate,
    plannedMonthly: baseMonthly,
    accounts: editedShares({ accounts: input.accounts, shares: edits.shares }),
  };
};

/**
 * A monthly amount counted toward the goal through a 25% share needs 4× that deposited into the
 * account; through a fixed amount, the same amount.
 */
export const getImpliedDeposits = ({
  monthly,
  accounts,
}: {
  monthly: number;
  accounts: GoalAccountShare[];
}): { accountId: RecordId; deposit: number }[] =>
  accounts.flatMap(({ accountId, sharePercent, fixedAmount }) => {
    if (fixedAmount !== null) return [{ accountId, deposit: monthly }];
    return sharePercent ? [{ accountId, deposit: (monthly * FULL_SHARE) / sharePercent }] : [];
  });

export const clampShare = ({ value, max }: { value: number | null; max: number }): number | null =>
  value === null ? null : Math.min(max, Math.max(0, roundShare(value)));

/** Round slider bounds around the largest relevant monthly figure; stays fixed while dragging. */
export const getMonthlySliderRange = ({
  amounts,
  remaining,
}: {
  amounts: (number | null)[];
  remaining: number;
}): { max: number; step: number } => {
  const largest = Math.max(0, ...amounts.map((amount) => amount ?? 0));
  const raw = largest > 0 ? largest * SLIDER_HEADROOM : remaining / MONTHS_PER_YEAR || FALLBACK_SLIDER_MAX;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const max = Math.ceil(raw / magnitude) * magnitude;
  return { max, step: Math.max(1, max / SLIDER_STEPS) };
};

const toEdits = ({ goal }: { goal: GoalModel }): GoalWhatIfEdits => ({
  monthly: goal.plannedMonthly,
  targetDate: goal.targetDate,
  shares: Object.fromEntries(
    goal.accounts.flatMap(({ accountId, sharePercent }) => (sharePercent === null ? [] : [[accountId, sharePercent]])),
  ),
});

export const useGoalWhatIf = ({ goal }: { goal: MaybeRefOrGetter<GoalWithInsights> }) => {
  const { data: goals } = useGoals();

  const edits = ref<GoalWhatIfEdits>(toEdits({ goal: toValue(goal) }));
  const reset = () => {
    edits.value = toEdits({ goal: toValue(goal) });
  };
  // Keyed on updatedAt: a refetch from an unrelated transaction must not wipe the sandbox.
  watch(() => toValue(goal).updatedAt, reset);

  const isDirty = computed(() => !isEqual(edits.value, toEdits({ goal: toValue(goal) })));

  /** Null until the goals list loads: other goals' shares are unknown, so the cap is too. */
  const shareCapacity = ({ accountId }: { accountId: RecordId }) =>
    goals.value ? getAccountShareCapacity({ goals: goals.value, accountId, editingGoal: toValue(goal) }) : null;

  const isOverMax = ({ accountId }: { accountId: RecordId }) => {
    const value = edits.value.shares[accountId] ?? null;
    const max = shareCapacity({ accountId })?.max;
    return value !== null && max !== undefined && roundShare(value) > max;
  };

  const hasShareError = computed(() => toValue(goal).accounts.some(({ accountId }) => isOverMax({ accountId })));

  /** Typed shares stay as entered so the field can show its error; the math and apply use them capped. */
  const cappedShares = computed(() =>
    Object.fromEntries(
      toValue(goal).accounts.map(({ accountId }) => [
        accountId,
        clampShare({
          value: edits.value.shares[accountId] ?? null,
          max: shareCapacity({ accountId })?.max ?? FULL_SHARE,
        }),
      ]),
    ),
  );

  const setShare = ({ accountId, value }: { accountId: RecordId; value: number | null }) => {
    edits.value.shares[accountId] = value;
  };

  const whatIf = computed(() => {
    const { insights, plannedMonthly } = toValue(goal);
    return computeGoalProgress(
      buildWhatIfInput({ insights, plannedMonthly, edits: { ...edits.value, shares: cappedShares.value } }),
    );
  });

  const sliderRange = computed(() => {
    const { insights, plannedMonthly } = toValue(goal);
    return getMonthlySliderRange({
      amounts: [
        plannedMonthly,
        toGoalCurrency({ amount: insights.historicalPace, insights }),
        toGoalCurrency({ amount: insights.neededMonthly, insights }),
      ],
      remaining: toGoalCurrency({ amount: insights.remaining, insights }),
    });
  });

  const applyValues = computed<GoalWhatIfApplyValues>(() => ({
    plannedMonthly: edits.value.monthly || null,
    targetDate: edits.value.targetDate,
    accounts: editedShares({ accounts: toValue(goal).accounts, shares: cappedShares.value }),
  }));

  return {
    edits,
    whatIf,
    isDirty,
    reset,
    shareCapacity,
    isOverMax,
    hasShareError,
    setShare,
    sliderRange,
    applyValues,
  };
};
