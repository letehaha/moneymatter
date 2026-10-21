import type { ChatProposalCard } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import ChatProposals from '@models/chat-proposals.model';

import { toChatProposalCard } from './to-chat-proposal-card';

/**
 * The caller's own card. Another user's card answers the same 404 as a missing one. With `lock` the
 * row is held `FOR UPDATE` until the surrounding transaction ends.
 */
export const findOwnedProposal = ({
  userId,
  proposalId,
  lock = false,
}: {
  userId: number;
  proposalId: string;
  lock?: boolean;
}): Promise<ChatProposals> =>
  findOrThrowNotFound({
    query: ChatProposals.findOne({ where: { id: proposalId, userId }, ...(lock ? { lock: true } : {}) }),
    message: t({ key: 'chat.proposalNotFound' }),
  });

/** Cards for rows already loaded; the parents they show are read in one more query. */
export async function buildCards({
  userId,
  rows,
}: {
  userId: number;
  rows: ChatProposals[];
}): Promise<ChatProposalCard[]> {
  const loaded = new Set(rows.map((row) => row.id as string));
  const missing = [...new Set(rows.flatMap((row) => row.dependsOn))].filter((id) => !loaded.has(id));
  const extra = missing.length > 0 ? await ChatProposals.findAll({ where: { id: missing, userId } }) : [];
  const byId = new Map([...rows, ...extra].map((row) => [row.id as string, row]));

  return rows.map((row) => toChatProposalCard({ row, parents: row.dependsOn.flatMap((id) => byId.get(id) ?? []) }));
}

/** The current cards for `ids`, in that order; an id that is not the caller's card is left out. */
export async function loadCards({ userId, ids }: { userId: number; ids: string[] }): Promise<ChatProposalCard[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await ChatProposals.findAll({ where: { id: unique, userId } });
  const byId = new Map(rows.map((row) => [row.id as string, row]));
  const ordered = unique.flatMap((id) => byId.get(id) ?? []);
  return buildCards({ userId, rows: ordered });
}
