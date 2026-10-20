import type { ChatAppliedPage } from '@bt/shared/types';
import ChatProposals from '@models/chat-proposals.model';
import ChatThreads from '@models/chat-threads.model';
import { Op } from 'sequelize';

import { buildCards } from './card-load';

/**
 * The user's applied cards, newest first, each with the thread it lives in. They go when their
 * thread goes. `cursor` is the id of the last card of the previous page; a cursor that is not one of
 * the user's applied cards gives an empty page.
 */
export async function listAppliedCards({
  userId,
  cursor,
  limit,
}: {
  userId: number;
  cursor?: string;
  limit: number;
}): Promise<ChatAppliedPage> {
  const where: Record<string | symbol, unknown> = { userId, status: 'applied', appliedAt: { [Op.ne]: null } };

  if (cursor) {
    const anchor = await ChatProposals.findOne({ where: { id: cursor, userId, status: 'applied' } });
    if (!anchor?.appliedAt) return { items: [], nextCursor: null };

    where[Op.or] = [
      { appliedAt: { [Op.lt]: anchor.appliedAt } },
      { appliedAt: anchor.appliedAt, id: { [Op.lt]: anchor.id } },
    ];
  }

  const found = await ChatProposals.findAll({
    where,
    order: [
      ['appliedAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: limit + 1,
  });
  const rows = found.slice(0, limit);

  const threads = await ChatThreads.findAll({
    where: { id: [...new Set(rows.map((row) => row.threadId))], userId },
    attributes: ['id', 'title'],
  });
  const titles = new Map(threads.map((thread) => [thread.id as string, thread.title]));
  const cards = await buildCards({ userId, rows });

  return {
    items: cards.map((card, index) => ({
      card,
      threadId: rows[index]!.threadId,
      threadTitle: titles.get(rows[index]!.threadId) ?? '',
    })),
    nextCursor: found.length > limit ? (rows.at(-1)!.id as string) : null,
  };
}
