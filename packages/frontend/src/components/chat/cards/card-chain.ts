import type { ChatCardTitle, ChatProposalCard, ChatProposalStatus } from '@bt/shared/types';

/** What an approval must be confirmed with: the strictest need among the cards it applies. */
export type ApprovalRequirement =
  | { mode: 'none' }
  | { mode: 'confirm' }
  | { mode: 'host'; expected: string }
  | { mode: 'typed'; expected: string };

/** A card the approval applies together with the target: a pending parent, known in full or only by its link. */
export interface ChainParent {
  id: string;
  revision: number;
  title: ChatCardTitle;
  status: ChatProposalStatus;
  /** Present when the parent's card is on the page. */
  card?: ChatProposalCard;
}

const REQUIREMENT_RANK: Record<ApprovalRequirement['mode'], number> = { none: 0, confirm: 1, host: 2, typed: 3 };

/**
 * The pending parents an approval of `card` applies first, nearest first, through any depth. A parent
 * whose card is not in `cards` is known by its link only, so its own parents cannot be followed.
 */
export const collectPendingParents = ({
  card,
  cards,
}: {
  card: ChatProposalCard;
  cards: Readonly<Record<string, ChatProposalCard>>;
}): ChainParent[] => {
  const seen = new Set<string>([card.id]);
  const parents: ChainParent[] = [];
  const queue = [...card.dependsOn];

  while (queue.length > 0) {
    const link = queue.shift()!;
    if (seen.has(link.id)) continue;
    seen.add(link.id);
    if (link.status !== 'pending') continue;

    const known = cards[link.id];
    parents.push({
      id: link.id,
      revision: known?.revision ?? link.revision,
      title: link.title,
      status: link.status,
      card: known,
    });
    if (known) queue.push(...known.dependsOn);
  }

  return parents;
};

/** The revisions of the pending parents, as the approve request carries them. */
export const parentRevisionsOf = ({ parents }: { parents: ChainParent[] }): Record<string, number> =>
  Object.fromEntries(parents.map((parent) => [parent.id, parent.revision]));

const requirementOf = ({ card }: { card: ChatProposalCard }): ApprovalRequirement => {
  if (card.confirmation.mode === 'typed' && card.confirmation.phrase) {
    return { mode: 'typed', expected: card.confirmation.phrase };
  }
  if (card.egress) return { mode: 'host', expected: card.egress.host };
  if (card.confirmation.mode !== 'none') return { mode: 'confirm' };
  return { mode: 'none' };
};

/** The strictest confirmation among the card and its known pending parents: a typed count, then a host, then the word. */
export const requirementOfChain = ({
  card,
  parents,
}: {
  card: ChatProposalCard;
  parents: ChainParent[];
}): ApprovalRequirement => {
  const cards = [card, ...parents.flatMap((parent) => (parent.card ? [parent.card] : []))];

  return cards
    .map((candidate) => requirementOf({ card: candidate }))
    .reduce<ApprovalRequirement>(
      (top, candidate) => (REQUIREMENT_RANK[candidate.mode] > REQUIREMENT_RANK[top.mode] ? candidate : top),
      { mode: 'none' },
    );
};

/** The text the approve request sends for a requirement the user satisfied; `undefined` when none is needed. */
export const confirmationFor = ({
  requirement,
  typed,
}: {
  requirement: ApprovalRequirement;
  typed: string;
}): string | undefined => {
  if (requirement.mode === 'none') return undefined;
  if (requirement.mode === 'confirm') return 'confirm';
  if (requirement.mode === 'host') return requirement.expected;
  return typed.trim();
};

/** Whether the typed text satisfies a typed requirement (case-insensitive, like the server). */
export const isTypedConfirmationMet = ({
  requirement,
  typed,
}: {
  requirement: ApprovalRequirement;
  typed: string;
}): boolean => requirement.mode !== 'typed' || typed.trim().toLowerCase() === requirement.expected.toLowerCase();
