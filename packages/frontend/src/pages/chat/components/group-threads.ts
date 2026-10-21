import type { ChatThreadSearchHit } from '@bt/shared/types';

interface ThreadGroup {
  key: 'pinned' | 'recent' | 'results';
  threads: ChatThreadSearchHit[];
}

/**
 * The thread list's sections: pinned threads first, then the rest, each in the order the server sent.
 * A search shows its hits as one list, since the server ranked them as a whole.
 */
export const groupThreads = ({
  threads,
  isSearching,
}: {
  threads: ChatThreadSearchHit[];
  isSearching: boolean;
}): ThreadGroup[] => {
  if (threads.length === 0) return [];
  if (isSearching) return [{ key: 'results', threads }];

  const groups: ThreadGroup[] = [
    { key: 'pinned', threads: threads.filter((thread) => thread.pinned) },
    { key: 'recent', threads: threads.filter((thread) => !thread.pinned) },
  ];
  return groups.filter((group) => group.threads.length > 0);
};
