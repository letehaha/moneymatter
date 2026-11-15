import {
  approveAllChatMessage,
  approveChatProposal,
  commentOnChatProposal,
  createChatThread,
  deleteChatThread,
  editChatProposal,
  getChatDefaultConnection,
  getChatThread,
  listChatAppliedCards,
  listChatThreads,
  refreshChatProposal,
  rejectChatProposal,
  updateChatSettings,
  updateChatThread,
} from '@/api/chat';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { cardsFromActionError, patchChatCardsInCache } from '@/composable/chat/chat-cards-cache';
import { joinsLatestPage, mergeThreadPages } from '@/composable/chat/merge-thread-pages';
import { useApplyInvalidation } from '@/composable/chat/use-apply-invalidation';
import { SSE_EVENT_TYPES, useSSE } from '@/composable/use-sse';
import type { ChatProposalCard } from '@bt/shared/types';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, onScopeDispose, ref, toValue, watch } from 'vue';

import { notifyMutationError, useInvalidatingMutation } from './use-invalidating-mutation';

/** A thread page holds up to this many messages (the server's ceiling): most threads fit in one. */
const THREAD_PAGE_SIZE = 100;
const THREAD_LIST_PAGE_SIZE = 30;
const APPLIED_PAGE_SIZE = 30;
const THREAD_LIST_STALE_TIME_MS = 30 * 1000;

const threadKey = ({ threadId }: { threadId: string | null }) => [...VUE_QUERY_CACHE_KEYS.chatThread, threadId];

/**
 * The thread list, a page at a time, newest activity first with pinned threads in front. `search`
 * matches titles and message text. Other tabs' changes arrive over the app's SSE channel.
 */
export const useChatThreadList = ({ search }: { search?: MaybeRefOrGetter<string> } = {}) => {
  const queryClient = useQueryClient();
  const { on } = useSSE();
  const term = computed(() => (toValue(search) ?? '').trim());

  const query = useInfiniteQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.chatThreads, 'list', term.value]),
    queryFn: ({ pageParam }) =>
      listChatThreads({ q: term.value || undefined, cursor: pageParam, limit: THREAD_LIST_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });

  const stopListening = on(SSE_EVENT_TYPES.CHAT_THREAD_UPDATED, ({ threadId }) => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.chatThreads });
    queryClient.invalidateQueries({ queryKey: threadKey({ threadId }) });
  });
  onScopeDispose(stopListening);

  const threads = computed(() => query.data.value?.pages.flatMap((page) => page.threads) ?? []);

  return { ...query, threads };
};

/**
 * A thread's conversation: the latest page plus any older pages loaded with `loadOlder`, merged
 * oldest first. Each page carries the cards of its proposal parts, so cards cost no requests of
 * their own. `GET /chat/proposals/:id` stays for refreshing a single card.
 */
export const useChatThread = ({ threadId }: { threadId: MaybeRefOrGetter<string | null> }) => {
  const id = computed(() => toValue(threadId));

  const latest = useQuery({
    queryKey: computed(() => [...threadKey({ threadId: id.value }), 'latest']),
    queryFn: () => getChatThread({ threadId: id.value!, limit: THREAD_PAGE_SIZE }),
    enabled: computed(() => id.value !== null),
  });

  // The `before` message of each older page, in the order the pages were loaded (nearest first).
  const olderBefore = ref<string[]>([]);
  const olderQueries = useQueries({
    queries: computed(() =>
      olderBefore.value.map((before) => ({
        queryKey: [...threadKey({ threadId: id.value }), 'before', before],
        queryFn: () => getChatThread({ threadId: id.value!, before, limit: THREAD_PAGE_SIZE }),
        // A page of older messages does not change except for its cards, which actions patch in place.
        staleTime: Infinity,
      })),
    ),
    combine: (results) => ({
      pages: results.flatMap((result) => (result.data ? [result.data] : [])),
      isLoading: results.some((result) => result.isPending),
    }),
  });

  watch(id, () => {
    olderBefore.value = [];
  });

  // Once the latest page has slid past the message the first older page was read before, those
  // pages no longer join it. Dropping them leaves "load older" to read the history again.
  watch(
    () => latest.data.value,
    (page) => {
      const anchor = olderBefore.value[0];
      if (page && anchor && !joinsLatestPage({ anchorId: anchor, latest: page })) olderBefore.value = [];
    },
  );

  const merged = computed(() =>
    latest.data.value ? mergeThreadPages({ latest: latest.data.value, older: olderQueries.value.pages }) : null,
  );

  const loadOlder = () => {
    const oldest = olderQueries.value.pages.at(-1)?.messages[0] ?? latest.data.value?.messages[0];
    if (!oldest || !merged.value?.hasMore || olderQueries.value.isLoading) return;
    olderBefore.value = [...olderBefore.value, oldest.id];
  };

  return {
    thread: computed(() => latest.data.value?.thread ?? null),
    messages: computed(() => merged.value?.messages ?? []),
    cards: computed<Record<string, ChatProposalCard>>(() => merged.value?.cards ?? {}),
    hasMore: computed(() => merged.value?.hasMore ?? false),
    isLoading: latest.isLoading,
    isError: latest.isError,
    error: latest.error,
    isLoadingOlder: computed(() => olderQueries.value.isLoading),
    loadOlder,
    refetch: latest.refetch,
  };
};

/**
 * The connection a new conversation would start on, for the picker of a conversation that has no thread
 * yet. It is read fresh each time such a conversation opens: the answer follows the latest thread.
 */
export const useChatDefaultConnection = ({ enabled }: { enabled: MaybeRefOrGetter<boolean> }) =>
  useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.chatDefaultConnection],
    queryFn: getChatDefaultConnection,
    enabled: computed(() => toValue(enabled)),
    staleTime: 0,
  });

export const useCreateChatThread = () =>
  useInvalidatingMutation({
    mutationFn: createChatThread,
    invalidateKeys: [[...VUE_QUERY_CACHE_KEYS.chatThreads], [...VUE_QUERY_CACHE_KEYS.chatDefaultConnection]],
    errorKey: 'chat.errors.threadAction',
  });

export const useUpdateChatThread = () =>
  useInvalidatingMutation({
    mutationFn: updateChatThread,
    invalidateKeys: [
      [...VUE_QUERY_CACHE_KEYS.chatThreads],
      [...VUE_QUERY_CACHE_KEYS.chatThread],
      [...VUE_QUERY_CACHE_KEYS.chatDefaultConnection],
    ],
    errorKey: 'chat.errors.threadAction',
  });

export const useDeleteChatThread = () => {
  const queryClient = useQueryClient();

  return useInvalidatingMutation({
    mutationFn: deleteChatThread,
    invalidateKeys: [[...VUE_QUERY_CACHE_KEYS.chatThreads]],
    errorKey: 'chat.errors.threadAction',
    // A deleted thread must not be refetched by an observer that still shows it.
    onSuccess: () => queryClient.removeQueries({ queryKey: VUE_QUERY_CACHE_KEYS.chatThread, type: 'inactive' }),
  });
};

/** The retention days, and every thread's expiry they set. */
export const useUpdateChatSettings = () =>
  useInvalidatingMutation({
    mutationFn: updateChatSettings,
    invalidateKeys: [
      [...VUE_QUERY_CACHE_KEYS.chatThreads],
      [...VUE_QUERY_CACHE_KEYS.chatThread],
      [...VUE_QUERY_CACHE_KEYS.userSettings],
    ],
    errorKey: 'chat.errors.settingsFailed',
  });

/** The applied changes of every thread, a page at a time. */
export const useChatAppliedCards = () =>
  useInfiniteQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.chatAppliedCards],
    queryFn: ({ pageParam }) => listChatAppliedCards({ cursor: pageParam, limit: APPLIED_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

/**
 * The actions on a card. Every answer carries the cards as they are now and replaces the copies in the
 * cached thread pages; a refused action (409, 422) carries them too, so the card shows why instead
 * of an error toast. An approval also refreshes what it changed.
 */
export const useChatCardActions = () => {
  const queryClient = useQueryClient();
  const { invalidateForCards } = useApplyInvalidation();

  const showCards = ({ cards }: { cards: ChatProposalCard[] }) => patchChatCardsInCache({ queryClient, cards });

  const onCardError = (error: unknown) => {
    const cards = cardsFromActionError({ error });
    if (cards.length > 0) return showCards({ cards });
    notifyMutationError({ error, fallbackKey: 'chat.errors.cardAction' });
  };

  const approve = useMutation({
    mutationFn: approveChatProposal,
    onSuccess: async ({ cards }) => {
      showCards({ cards });
      await invalidateForCards({ cards });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.chatAppliedCards });
    },
    onError: onCardError,
  });

  const approveAll = useMutation({
    mutationFn: approveAllChatMessage,
    onSuccess: async ({ cards }) => {
      showCards({ cards });
      await invalidateForCards({ cards });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.chatAppliedCards });
    },
    onError: onCardError,
  });

  const reject = useMutation({
    mutationFn: rejectChatProposal,
    onSuccess: ({ cards }) => showCards({ cards }),
    onError: onCardError,
  });

  const edit = useMutation({
    mutationFn: editChatProposal,
    onSuccess: (card) => showCards({ cards: [card] }),
    onError: onCardError,
  });

  const refresh = useMutation({
    mutationFn: refreshChatProposal,
    onSuccess: (card) => showCards({ cards: [card] }),
    onError: onCardError,
  });

  /** A comment starts a run, like a message: follow it with `useChatRun().attach` using the answer. */
  const comment = useMutation({
    mutationFn: commentOnChatProposal,
    onError: onCardError,
  });

  return { approve, approveAll, reject, edit, refresh, comment };
};
