import type { ChatProposalCard, ChatProposalStatus } from '@bt/shared/types';
import { expect } from '@jest/globals';
import ChatProposals from '@models/chat-proposals.model';
import Users from '@models/users.model';
import { registerMockSession } from '@tests/mocks/better-auth';
import {
  createChatScript,
  type ChatCompletionRequestBody,
  type ChatScript,
  type ChatScriptTurn,
} from '@tests/mocks/openai-compatible/chat-script';

import { createChatThread, getChatRunEvents, sendChatMessage } from './chat';
import { extractCookies, makeAuthRequest } from './common';
import { createFirstConnection } from './user-settings';

/**
 * The `$proposal:` refs a scripted model has been handed so far, in the order of the propose calls
 * that returned them. A turn written as a function of the request body uses them to build a call
 * that depends on an earlier card.
 */
export const proposalRefsIn = ({ body }: { body: ChatCompletionRequestBody }): string[] =>
  (body.messages ?? [])
    .filter((message) => message.role === 'tool')
    .flatMap((message) => {
      try {
        const parsed = JSON.parse(String(message.content)) as { ref?: unknown };
        return typeof parsed.ref === 'string' ? [parsed.ref] : [];
      } catch {
        return [];
      }
    });

export interface ProposedCards {
  threadId: string;
  runId: string;
  messageId: string;
  script: ChatScript;
  /** The cards the run made, in order of first appearance, as the stream last showed them. */
  cards: ChatProposalCard[];
}

/**
 * Sends one message to a scripted model and returns the cards its run proposed. Connects a model on
 * the first call of a test; pass `threadId` to continue in a thread (the model is then connected).
 */
export async function proposeCards({
  turns,
  text = 'Please make these changes',
  threadId,
}: {
  turns: ChatScriptTurn[];
  text?: string;
  threadId?: string;
}): Promise<ProposedCards> {
  if (!threadId) await createFirstConnection();
  const script = createChatScript({ turns });
  global.mswMockServer.use(script.handler);

  const thread = threadId ?? (await createChatThread({ raw: true })).id;
  const sent = await sendChatMessage({ threadId: thread, payload: { text }, raw: true });
  const { events } = await getChatRunEvents({ runId: sent.runId });

  const byId = new Map<string, ChatProposalCard>();
  for (const event of events) {
    if (event.type === 'proposal.upserted') byId.set(event.card.id, event.card);
  }

  return {
    threadId: thread,
    runId: sent.runId,
    messageId: sent.messageId,
    script,
    cards: [...byId.values()],
  };
}

/** The card a run proposed for `toolName`, in order of appearance. */
export function cardFor({
  cards,
  toolName,
  index = 0,
}: {
  cards: ChatProposalCard[];
  toolName: string;
  index?: number;
}) {
  const card = cards.filter((candidate) => candidate.toolName === toolName)[index];
  if (!card) throw new Error(`The run proposed no ${toolName} card at position ${index}`);
  return card;
}

/** Reads a card's stored status straight from the table, for states the API would not show yet. */
export async function storedStatus({ proposalId }: { proposalId: string }): Promise<ChatProposalStatus> {
  const row = await ChatProposals.findByPk(proposalId);
  return row!.status;
}

/** A demo user from `POST /demo`, with its session registered in the auth mock. */
export async function provisionDemoUser(): Promise<{ cookies: string }> {
  const savedCookies = global.APP_AUTH_COOKIES;
  global.APP_AUTH_COOKIES = null;
  try {
    const res = await makeAuthRequest({ method: 'post', url: '/demo' });
    expect(res.statusCode).toBe(200);
    const userId = res.body.response.user.id as number;
    const cookies = extractCookies(res);
    const sessionToken = cookies.match(/bt_auth\.session_token=([^;]+)/)?.[1];
    const demoUser = await Users.findByPk(userId);
    registerMockSession(sessionToken!, { id: demoUser!.authUserId, email: `demo-${userId}@demo.local` });
    return { cookies };
  } finally {
    global.APP_AUTH_COOKIES = savedCookies;
  }
}
