import type { ChatProposalSnapshot, ChatProposalStatus } from '@bt/shared/types';
import { getBaseCurrency } from '@models/users-currencies.model';
import { createHash } from 'crypto';

/** Hash of a target set; the order and repeats of the ids do not matter. */
export const hashTargetIds = ({ ids }: { ids: string[] }): string =>
  createHash('sha256')
    .update([...new Set(ids)].toSorted().join(','))
    .digest('hex');

/** The newest of several timestamps, as an ISO string; `null` when there is none. */
export function latestUpdatedAt({ dates }: { dates: Array<Date | string | null | undefined> }): string | null {
  const times = dates.flatMap((date) => (date ? [new Date(date).getTime()] : []));
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * What a preview was computed against: what the resolver captured (target set, newest `updatedAt`),
 * the user's base currency, and the status each parent card had. Approval builds it again the same
 * way and compares the two.
 */
export async function buildSnapshot({
  userId,
  resolved,
  parents,
}: {
  userId: number;
  resolved?: Partial<ChatProposalSnapshot>;
  parents: Array<{ id: string; status: ChatProposalStatus }>;
}): Promise<ChatProposalSnapshot> {
  return {
    baseCurrencyCode: (await getBaseCurrency({ userId }))?.currencyCode ?? '',
    ...resolved,
    parentStatuses: Object.fromEntries(parents.map((parent) => [parent.id, parent.status])),
  };
}

type SnapshotComparison = { stale: false } | { stale: true; reasonKey: string; before: unknown; after: unknown };

const FRESH: SnapshotComparison = { stale: false };

const targetCountOf = ({ snapshot }: { snapshot: ChatProposalSnapshot }): number | null =>
  snapshot.targetCount ?? snapshot.targetIds?.length ?? null;

/**
 * Whether what a card was previewed against has moved: the base currency, a parent card, the target
 * set or a target's `updatedAt`. The first difference wins, in that order, and carries the before and
 * after values the card shows. A parent that was applied meanwhile is not a move: the approval
 * replaces its ref with the id it created. A check applies only when the stored snapshot holds the
 * value to compare.
 */
export function compareSnapshots({
  stored,
  current,
}: {
  stored: ChatProposalSnapshot;
  current: ChatProposalSnapshot;
}): SnapshotComparison {
  if (stored.baseCurrencyCode !== current.baseCurrencyCode) {
    return {
      stale: true,
      reasonKey: 'chat.stale.baseCurrency',
      before: stored.baseCurrencyCode,
      after: current.baseCurrencyCode,
    };
  }

  for (const [id, before] of Object.entries(stored.parentStatuses ?? {})) {
    const after = current.parentStatuses?.[id] ?? null;
    if (after !== before && after !== 'applied') {
      return { stale: true, reasonKey: 'chat.stale.parent', before, after };
    }
  }

  if (stored.targetHash !== undefined && stored.targetHash !== current.targetHash) {
    return {
      stale: true,
      reasonKey: 'chat.stale.targets',
      before: targetCountOf({ snapshot: stored }),
      after: targetCountOf({ snapshot: current }),
    };
  }

  if (stored.updatedAt !== undefined && stored.updatedAt !== (current.updatedAt ?? null)) {
    return { stale: true, reasonKey: 'chat.stale.updated', before: stored.updatedAt, after: current.updatedAt ?? null };
  }

  return FRESH;
}
