import { AssignmentAmounts, resolveAssigned } from './resolve-assigned';

export interface MergeLine {
  /** The periods of the line's lifetime, in order. */
  periodIds: string[];
  rows: Map<string, AssignmentAmounts>;
}

/** `row: null` means the stored row goes away. */
export interface MergeWrite {
  periodId: string;
  row: AssignmentAmounts | null;
}

const walk = ({ periodIds, rows }: MergeLine): Map<string, { baseline: number; assigned: number }> => {
  const resolved = new Map<string, { baseline: number; assigned: number }>();
  let baseline = 0;

  for (const periodId of periodIds) {
    const step = resolveAssigned({ row: rows.get(periodId), baseline });
    baseline = step.baseline;
    resolved.set(periodId, { baseline, assigned: step.assigned });
  }

  return resolved;
};

/** The line's own running baseline, written out so a summed one cannot run on. */
const restoreAfter = ({
  line,
  walked,
  lastShared,
}: {
  line: MergeLine;
  walked: Map<string, { baseline: number }>;
  lastShared: string;
}): MergeWrite[] => {
  const periodId = line.periodIds[line.periodIds.indexOf(lastShared) + 1];
  if (periodId === undefined) return [];

  const existing = line.rows.get(periodId);
  if (existing?.baselineAmount != null) return [];

  return [
    {
      periodId,
      row: { overrideAmount: null, carryPolicy: null, ...existing, baselineAmount: walked.get(periodId)!.baseline },
    },
  ];
};

/** Sum of assigned per period is unchanged; sum of available is not, since a carry policy is dropped. */
export const mergeLineAmounts = ({
  source,
  target,
  sharedPeriodIds,
}: {
  source: MergeLine;
  target: MergeLine;
  sharedPeriodIds: string[];
}): { source: MergeWrite[]; target: MergeWrite[] } => {
  const firstShared = sharedPeriodIds[0];
  const lastShared = sharedPeriodIds.at(-1);
  if (firstShared === undefined || lastShared === undefined) return { source: [], target: [] };

  const sourceWalk = walk(source);
  const targetWalk = walk(target);

  const targetWrites = sharedPeriodIds.map((periodId): MergeWrite => {
    const from = source.rows.get(periodId);
    const into = target.rows.get(periodId);
    const rebased = periodId === firstShared || from?.baselineAmount != null || into?.baselineAmount != null;
    const overridden = from?.overrideAmount != null || into?.overrideAmount != null;

    return {
      periodId,
      row: {
        baselineAmount: rebased ? sourceWalk.get(periodId)!.baseline + targetWalk.get(periodId)!.baseline : null,
        overrideAmount: overridden ? sourceWalk.get(periodId)!.assigned + targetWalk.get(periodId)!.assigned : null,
        carryPolicy: into?.carryPolicy ?? null,
      },
    };
  });

  const before = source.periodIds[source.periodIds.indexOf(firstShared) - 1];
  const incoming = before === undefined ? 0 : sourceWalk.get(before)!.baseline;

  const sourceWrites = sharedPeriodIds.flatMap((periodId): MergeWrite[] => {
    if (periodId === firstShared && incoming !== 0) {
      return [{ periodId, row: { baselineAmount: 0, overrideAmount: null, carryPolicy: null } }];
    }
    return source.rows.has(periodId) ? [{ periodId, row: null }] : [];
  });

  // A source baseline of 0 runs on by itself on both sides, and writing it out
  // would give an emptied source line a row it is supposed to end without.
  const runsOn = sourceWalk.get(lastShared)!.baseline !== 0;

  return {
    source: [...sourceWrites, ...(runsOn ? restoreAfter({ line: source, walked: sourceWalk, lastShared }) : [])],
    target: [...targetWrites, ...(runsOn ? restoreAfter({ line: target, walked: targetWalk, lastShared }) : [])],
  };
};
