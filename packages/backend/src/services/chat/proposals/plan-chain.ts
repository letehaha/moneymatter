import type { ChatConfirmationMode, ChatProposalStatus } from '@bt/shared/types';

/** What the planner needs to know about one card of a chain. */
export interface ChainRow {
  id: string;
  status: ChatProposalStatus;
  revision: number;
  toolName: string;
  dependsOn: string[];
  confirmation: ChatConfirmationMode;
  confirmationPhrase: string | null;
  /** The host an egress card contacts; null for any other card. */
  egressHost: string | null;
}

type ChainPlan =
  | {
      ok: true;
      /** The pending cards to apply, parents first and the target last. */
      order: string[];
      /** Parents an earlier approval applied already: their results fill the refs. */
      appliedParents: string[];
    }
  | {
      ok: false;
      reason: 'missing' | 'notPending' | 'standalone' | 'cycle';
      proposalId: string;
      status?: ChatProposalStatus;
    };

type ConfirmationRequirement =
  | { mode: 'none' }
  | { mode: 'confirm' }
  | { mode: 'host'; expected: string }
  | { mode: 'typed'; expected: string };

/**
 * The cards one approval applies. A card is applied after every parent it refers to, in topological
 * order. A parent applied by an earlier approval is not applied again: its result fills the refs.
 * A parent in any other state than `pending` blocks the whole approval, and a standalone tool takes
 * part in no chain.
 */
export function planChain({
  targetId,
  rows,
  isStandalone,
}: {
  targetId: string;
  rows: Map<string, ChainRow>;
  isStandalone: (params: { toolName: string }) => boolean;
}): ChainPlan {
  const order: string[] = [];
  const appliedParents: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  let refusal: Extract<ChainPlan, { ok: false }> | null = null;

  const visit = (id: string): void => {
    if (refusal || done.has(id)) return;

    const row = rows.get(id);
    if (!row) {
      refusal = { ok: false, reason: 'missing', proposalId: id };
      return;
    }
    if (visiting.has(id)) {
      refusal = { ok: false, reason: 'cycle', proposalId: id };
      return;
    }
    if (row.status === 'applied' && id !== targetId) {
      done.add(id);
      appliedParents.push(id);
      return;
    }
    if (row.status !== 'pending') {
      refusal = { ok: false, reason: 'notPending', proposalId: id, status: row.status };
      return;
    }

    visiting.add(id);
    for (const dependency of row.dependsOn) visit(dependency);
    visiting.delete(id);
    if (refusal) return;

    done.add(id);
    order.push(id);
  };

  visit(targetId);
  if (refusal) return refusal;

  if (order.length > 1 || appliedParents.length > 0) {
    const standalone = [...order, ...appliedParents].find((id) => isStandalone({ toolName: rows.get(id)!.toolName }));
    if (standalone) return { ok: false, reason: 'standalone', proposalId: standalone };
  }

  return { ok: true, order, appliedParents };
}

/** The first card of the chain whose revision is not the one the request saw; null when all match. */
export function findRevisionMismatch({
  order,
  rows,
  targetId,
  revision,
  parentRevisions,
}: {
  order: string[];
  rows: Map<string, ChainRow>;
  targetId: string;
  revision: number;
  parentRevisions: Record<string, number>;
}): string | null {
  for (const id of order) {
    const seen = id === targetId ? revision : parentRevisions[id];
    if (seen !== rows.get(id)!.revision) return id;
  }
  return null;
}

const REQUIREMENT_RANK: Record<ConfirmationRequirement['mode'], number> = { none: 0, confirm: 1, host: 2, typed: 3 };

const requirementOf = ({ row }: { row: ChainRow }): ConfirmationRequirement => {
  if (row.confirmation === 'typed' && row.confirmationPhrase)
    return { mode: 'typed', expected: row.confirmationPhrase };
  if (row.egressHost) return { mode: 'host', expected: row.egressHost };
  if (row.confirmation !== 'none') return { mode: 'confirm' };
  return { mode: 'none' };
};

/**
 * What the approval must be confirmed with: the strictest requirement among the cards. The affected
 * count of a typed card beats the host of an egress card, which beats the plain word.
 */
export function strictestRequirement({ rows }: { rows: ChainRow[] }): ConfirmationRequirement {
  return rows
    .map((row) => requirementOf({ row }))
    .reduce<ConfirmationRequirement>(
      (top, candidate) => (REQUIREMENT_RANK[candidate.mode] > REQUIREMENT_RANK[top.mode] ? candidate : top),
      { mode: 'none' },
    );
}

export function confirmationMatches({
  requirement,
  confirmation,
}: {
  requirement: ConfirmationRequirement;
  confirmation: string | undefined;
}): boolean {
  if (requirement.mode === 'none') return true;

  const given = confirmation?.trim().toLowerCase();
  if (!given) return false;

  return requirement.mode === 'confirm' ? given === 'confirm' : given === requirement.expected.toLowerCase();
}
