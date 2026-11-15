import type { ChatEntityRef, ChatPageContext, ChatThread } from '@bt/shared/types';

import { sanitizePageContext } from '../prompt/page-context';
import { entityKey, lookupEntities } from '../toolkit/entity-ownership';

/**
 * The page context to store on a thread: what the browser sent, less the ids the user does not own. The
 * names `sanitizePageContext` adds are left out, since a name is read when the thread is shown and the
 * entity may be renamed or gone by then.
 */
export async function normalizeThreadPageContext({
  userId,
  context,
}: {
  userId: number;
  context: ChatPageContext | null | undefined;
}): Promise<ChatPageContext | null> {
  const sanitized = await sanitizePageContext({ userId, context: context ?? null });
  if (!sanitized) return null;

  const { names: _names, ...stored } = sanitized;
  return stored;
}

const namedRefs = ({ context }: { context: ChatPageContext | null }): ChatEntityRef[] =>
  [context?.entity, context?.focus].filter((ref): ref is ChatEntityRef => ref !== undefined);

/**
 * Fills `pageContextNames` of the threads with one lookup for the whole page of them. A context made of
 * a route alone, which is all a page with secrets sends, looks nothing up.
 */
export async function withPageContextNames({
  userId,
  threads,
}: {
  userId: number;
  threads: ChatThread[];
}): Promise<ChatThread[]> {
  const refs = threads.flatMap(({ pageContext }) => namedRefs({ context: pageContext }));
  if (refs.length === 0) return threads;

  const { labels } = await lookupEntities({ userId, refs });
  return threads.map((thread) => {
    const names: Record<string, string> = {};
    for (const ref of namedRefs({ context: thread.pageContext })) {
      const name = labels.get(entityKey(ref));
      if (name) names[entityKey(ref)] = name;
    }
    return { ...thread, pageContextNames: names };
  });
}
