import type { ChatProposalCard } from '@bt/shared/types';

import { expireDueCards, isExpiryDue } from './card-expiry';
import { findOwnedProposal, loadCards } from './card-load';

/** The caller's card. A pending card past its lifetime is turned into `expired` first, so it never reads as approvable. */
export async function getProposalCard({
  userId,
  proposalId,
}: {
  userId: number;
  proposalId: string;
}): Promise<ChatProposalCard> {
  const row = await findOwnedProposal({ userId, proposalId });
  if (isExpiryDue({ row })) await expireDueCards({ ids: [proposalId] });

  const [card] = await loadCards({ userId, ids: [proposalId] });
  return card!;
}
