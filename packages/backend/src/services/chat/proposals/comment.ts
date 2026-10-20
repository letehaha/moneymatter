import type { ChatSendMessageResponse } from '@bt/shared/types';

import { startChatRun } from '../runs/start-run';
import { findOwnedProposal } from './card-load';

/**
 * A comment on a card is a message in the card's thread that names the card. It starts a run like
 * any message does (same rate budget, same one-run-per-thread rule); the model sees the card and the
 * comment, and answers with a replacement card that supersedes the old one, or with text.
 */
export async function commentOnProposal({
  user,
  proposalId,
  text,
}: {
  user: { id: number };
  proposalId: string;
  text: string;
}): Promise<ChatSendMessageResponse> {
  const card = await findOwnedProposal({ userId: user.id, proposalId });

  return startChatRun({
    user,
    threadId: card.threadId,
    text,
    attachmentIds: [],
    cardComment: { proposalId },
  });
}
