import type { ChatThreadListPage } from '@bt/shared/types';
import { connection } from '@models/index';
import { QueryTypes } from 'sequelize';

import { withPageContextNames } from './thread-page-context';
import { buildPrefixTsQuery, buildSnippet, buildTitlePattern } from './thread-search';
import { type ChatThreadRow, toChatThread } from './to-chat-thread';

interface ThreadListRow extends ChatThreadRow {
  /** Text of the newest message that matched the search words; null without a text match. */
  matchText: string | null;
}

/**
 * The user's threads, pinned first, then newest message first. `cursor` is the id of the last
 * thread of the previous page.
 *
 * `q` matches a title as a substring (`ILIKE`) or a message by its words, each as a prefix
 * (full text, `simple` configuration, so `en` and `uk` text behave alike). A thread found through
 * a message carries a plain-text snippet of the newest matching one.
 */
export const listThreads = async ({
  userId,
  q,
  cursor,
  limit,
}: {
  userId: number;
  q?: string;
  cursor?: string;
  limit: number;
}): Promise<ChatThreadListPage> => {
  const query = q?.trim() || undefined;
  const tsQuery = query ? buildPrefixTsQuery({ q: query }) : null;

  const joins = tsQuery
    ? `LEFT JOIN LATERAL (
         SELECT cm."plainText"
         FROM "ChatMessages" AS cm
         WHERE cm."threadId" = t.id AND cm."searchVector" @@ to_tsquery('simple', $tsQuery)
         ORDER BY cm."createdAt" DESC, cm.id DESC
         LIMIT 1
       ) AS m ON TRUE`
    : '';
  const conditions = ['t."userId" = $userId'];
  const bind: Record<string, string | number> = { userId, limitPlusOne: limit + 1 };

  if (query) {
    bind.titlePattern = buildTitlePattern({ q: query });
    conditions.push(
      tsQuery ? '(t.title ILIKE $titlePattern OR m."plainText" IS NOT NULL)' : 't.title ILIKE $titlePattern',
    );
  }
  if (tsQuery) bind.tsQuery = tsQuery;

  if (cursor) {
    // A cursor that names no thread of the user ends the listing.
    conditions.push(`(t.pinned, t."lastMessageAt", t.id) < (
      SELECT c.pinned, c."lastMessageAt", c.id FROM "ChatThreads" AS c WHERE c.id = $cursor AND c."userId" = $userId
    )`);
    bind.cursor = cursor;
  }

  const rows = await connection.sequelize.query(
    `SELECT t.id, t.title, t."titleSource", t.pinned, t."lastMessageAt", t."expiresAt", t."connectionId", t."modelId", t."pageContext",
            t."inputTokens", t."outputTokens", t."cachedInputTokens", t."createdAt",
            ${tsQuery ? 'm."plainText"' : 'NULL::text'} AS "matchText"
     FROM "ChatThreads" AS t
     ${joins}
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.pinned DESC, t."lastMessageAt" DESC, t.id DESC
     LIMIT $limitPlusOne`,
    { bind, type: QueryTypes.SELECT },
  );

  const page = (rows as ThreadListRow[]).slice(0, limit);

  const named = await withPageContextNames({ userId, threads: page.map((row) => toChatThread({ row })) });

  return {
    threads: named.map((thread, index) => ({
      ...thread,
      ...(query && page[index]!.matchText
        ? { snippet: buildSnippet({ text: page[index]!.matchText!, q: query }) }
        : {}),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
  };
};
