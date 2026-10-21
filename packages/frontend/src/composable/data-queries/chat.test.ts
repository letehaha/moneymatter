import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ApiErrorResponseError } from '@/js/errors';
import {
  API_ERROR_CODES,
  type ChatMessage,
  type ChatProposalCard,
  type ChatThread,
  type ChatThreadWithMessages,
  SSE_EVENT_TYPES,
} from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useChatCardActions, useChatThread, useChatThreadList } from './chat';

const api = {
  getChatThread: vi.fn(),
  listChatThreads: vi.fn(),
  approveChatProposal: vi.fn(),
  rejectChatProposal: vi.fn(),
};
const invalidateForCards = vi.fn();
const notifyMutationError = vi.fn();
let sseHandler: ((payload: { threadId: string }) => void) | null = null;
const stopListening = vi.fn();

vi.mock('@/api/chat', () => ({
  getChatThread: (...args: unknown[]) => api.getChatThread(...args),
  listChatThreads: (...args: unknown[]) => api.listChatThreads(...args),
  approveChatProposal: (...args: unknown[]) => api.approveChatProposal(...args),
  rejectChatProposal: (...args: unknown[]) => api.rejectChatProposal(...args),
  approveAllChatMessage: vi.fn(),
  commentOnChatProposal: vi.fn(),
  createChatThread: vi.fn(),
  deleteChatThread: vi.fn(),
  editChatProposal: vi.fn(),
  listChatAppliedCards: vi.fn(),
  refreshChatProposal: vi.fn(),
  updateChatSettings: vi.fn(),
  updateChatThread: vi.fn(),
}));
vi.mock('@/composable/chat/use-apply-invalidation', () => ({
  useApplyInvalidation: () => ({ invalidateForCards: (...args: unknown[]) => invalidateForCards(...args) }),
}));
vi.mock('@/composable/use-sse', () => ({
  SSE_EVENT_TYPES: { CHAT_THREAD_UPDATED: 'chat_thread_updated' },
  useSSE: () => ({
    on: (_type: string, handler: (payload: { threadId: string }) => void) => {
      sseHandler = handler;
      return stopListening;
    },
  }),
}));
vi.mock('./use-invalidating-mutation', () => ({
  notifyMutationError: (...args: unknown[]) => notifyMutationError(...args),
  useInvalidatingMutation: vi.fn(),
}));

const message = (id: string) => ({ id, parts: [] }) as unknown as ChatMessage;
const card = ({ id, status = 'pending' }: { id: string; status?: ChatProposalCard['status'] }) =>
  ({ id, status, revision: 1 }) as ChatProposalCard;
const thread = (id: string) => ({ id, title: id }) as ChatThread;
const page = ({
  ids,
  cards = [],
  hasMore = false,
}: {
  ids: string[];
  cards?: ChatProposalCard[];
  hasMore?: boolean;
}): ChatThreadWithMessages => ({
  thread: thread('t1'),
  messages: ids.map(message),
  cards: Object.fromEntries(cards.map((item) => [item.id, item])),
  hasMore,
});

const mountHook = <T>({ hook, queryClient }: { hook: () => T; queryClient: QueryClient }) => {
  let result!: T;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = hook();
        return () => null;
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return { result, wrapper };
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

beforeEach(() => {
  vi.clearAllMocks();
  sseHandler = null;
});

describe('useChatThread', () => {
  it('reads cards from the thread response without asking for them one by one', async () => {
    api.getChatThread.mockResolvedValue(page({ ids: ['m1', 'm2'], cards: [card({ id: 'c1' })] }));
    const { result } = mountHook({ hook: () => useChatThread({ threadId: 't1' }), queryClient: newClient() });

    await flushPromises();

    expect(result.messages.value.map((item) => item.id)).toEqual(['m1', 'm2']);
    expect(Object.keys(result.cards.value)).toEqual(['c1']);
    expect(result.thread.value?.id).toBe('t1');
    expect(api.getChatThread).toHaveBeenCalledTimes(1);
    expect(api.getChatThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 't1' }));
  });

  it('does not read anything without a thread', async () => {
    const { result } = mountHook({ hook: () => useChatThread({ threadId: null }), queryClient: newClient() });

    await flushPromises();

    expect(api.getChatThread).not.toHaveBeenCalled();
    expect(result.messages.value).toEqual([]);
  });

  it('loads the page before the oldest message and shows it in front', async () => {
    api.getChatThread.mockImplementation(async ({ before }: { before?: string }) =>
      before
        ? page({ ids: ['m1', 'm2'], hasMore: false, cards: [card({ id: 'old' })] })
        : page({ ids: ['m3', 'm4'], hasMore: true }),
    );
    const { result } = mountHook({ hook: () => useChatThread({ threadId: 't1' }), queryClient: newClient() });
    await flushPromises();
    expect(result.hasMore.value).toBe(true);

    result.loadOlder();
    await flushPromises();

    expect(api.getChatThread).toHaveBeenLastCalledWith(expect.objectContaining({ before: 'm3' }));
    expect(result.messages.value.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(Object.keys(result.cards.value)).toEqual(['old']);
    expect(result.hasMore.value).toBe(false);
  });

  it('has nothing older to load when the page says so', async () => {
    api.getChatThread.mockResolvedValue(page({ ids: ['m1'], hasMore: false }));
    const { result } = mountHook({ hook: () => useChatThread({ threadId: 't1' }), queryClient: newClient() });
    await flushPromises();

    result.loadOlder();
    await flushPromises();

    expect(api.getChatThread).toHaveBeenCalledTimes(1);
  });

  it('drops the older pages when the latest page has slid past them', async () => {
    let latestIds = ['m3', 'm4'];
    api.getChatThread.mockImplementation(async ({ before }: { before?: string }) =>
      before ? page({ ids: ['m1', 'm2'] }) : page({ ids: latestIds, hasMore: true }),
    );
    const queryClient = newClient();
    const { result } = mountHook({ hook: () => useChatThread({ threadId: 't1' }), queryClient });
    await flushPromises();
    result.loadOlder();
    await flushPromises();
    expect(result.messages.value).toHaveLength(4);

    latestIds = ['m6', 'm7'];
    await queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.chatThread });
    await flushPromises();

    expect(result.messages.value.map((item) => item.id)).toEqual(['m6', 'm7']);
    expect(result.hasMore.value).toBe(true);
  });

  it('shows a card that an action replaced in the cache', async () => {
    api.getChatThread.mockResolvedValue(page({ ids: ['m1'], cards: [card({ id: 'c1' })] }));
    const queryClient = newClient();
    const { result } = mountHook({ hook: () => useChatThread({ threadId: 't1' }), queryClient });
    await flushPromises();

    const { patchChatCardsInCache } = await import('@/composable/chat/chat-cards-cache');
    patchChatCardsInCache({ queryClient, cards: [card({ id: 'c1', status: 'applied' })] });
    await flushPromises();

    expect(result.cards.value.c1!.status).toBe('applied');
  });
});

describe('useChatThreadList', () => {
  const listPage = (ids: string[], nextCursor: string | null) => ({ threads: ids.map(thread), nextCursor });

  it('lists the threads of every page loaded', async () => {
    api.listChatThreads.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor ? listPage(['t3'], null) : listPage(['t1', 't2'], 't2'),
    );
    const { result } = mountHook({ hook: () => useChatThreadList(), queryClient: newClient() });
    await flushPromises();

    expect(result.threads.value.map((item) => item.id)).toEqual(['t1', 't2']);
    await result.fetchNextPage();
    await flushPromises();

    expect(result.threads.value.map((item) => item.id)).toEqual(['t1', 't2', 't3']);
    expect(api.listChatThreads).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 't2' }));
  });

  it('searches with the trimmed term and reads a blank one as no search', async () => {
    api.listChatThreads.mockResolvedValue(listPage([], null));
    const { result } = mountHook({
      hook: () => useChatThreadList({ search: () => '  coffee ' }),
      queryClient: newClient(),
    });
    await flushPromises();
    mountHook({ hook: () => useChatThreadList({ search: () => '   ' }), queryClient: newClient() });
    await flushPromises();

    expect(api.listChatThreads).toHaveBeenNthCalledWith(1, expect.objectContaining({ q: 'coffee' }));
    expect(api.listChatThreads).toHaveBeenNthCalledWith(2, expect.objectContaining({ q: undefined }));
    expect(result.threads.value).toEqual([]);
  });

  it('refreshes the list and the thread when another tab changes a thread, and stops listening on unmount', async () => {
    api.listChatThreads.mockResolvedValue(listPage([], null));
    const queryClient = newClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { wrapper } = mountHook({ hook: () => useChatThreadList(), queryClient });
    await flushPromises();

    sseHandler!({ threadId: 't9' });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: VUE_QUERY_CACHE_KEYS.chatThreads });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [...VUE_QUERY_CACHE_KEYS.chatThread, 't9'] });
    expect(SSE_EVENT_TYPES.CHAT_THREAD_UPDATED).toBe('chat_thread_updated');

    wrapper.unmount();
    expect(stopListening).toHaveBeenCalledTimes(1);
  });
});

describe('useChatCardActions', () => {
  const cachedThread = async ({ queryClient }: { queryClient: QueryClient }) => {
    queryClient.setQueryData(
      [...VUE_QUERY_CACHE_KEYS.chatThread, 't1', 'latest'],
      page({ ids: ['m1'], cards: [card({ id: 'c1' }), card({ id: 'c2' })] }),
    );
  };
  const cardsOf = ({ queryClient }: { queryClient: QueryClient }) =>
    queryClient.getQueryData<ChatThreadWithMessages>([...VUE_QUERY_CACHE_KEYS.chatThread, 't1', 'latest'])!.cards;

  it('shows every card of the chain after an approval and refreshes what it changed', async () => {
    const queryClient = newClient();
    await cachedThread({ queryClient });
    const applied = [card({ id: 'c1', status: 'applied' }), card({ id: 'c2', status: 'applied' })];
    api.approveChatProposal.mockResolvedValue({ card: applied[1], cards: applied });
    const { result } = mountHook({ hook: () => useChatCardActions(), queryClient });

    await result.approve.mutateAsync({ proposalId: 'c2', payload: { revision: 1 } });

    expect(cardsOf({ queryClient }).c1!.status).toBe('applied');
    expect(cardsOf({ queryClient }).c2!.status).toBe('applied');
    expect(invalidateForCards).toHaveBeenCalledWith({ cards: applied });
  });

  it('replaces the stale card with the one a refused action answers with, without a toast', async () => {
    const queryClient = newClient();
    await cachedThread({ queryClient });
    const current = card({ id: 'c1', status: 'stale' });
    api.approveChatProposal.mockRejectedValue(
      new ApiErrorResponseError('Conflict', {
        code: API_ERROR_CODES.conflict,
        message: 'Conflict',
        details: { reason: 'stale', card: current, cards: [current] },
      }),
    );
    const { result } = mountHook({ hook: () => useChatCardActions(), queryClient });

    await expect(result.approve.mutateAsync({ proposalId: 'c1', payload: { revision: 1 } })).rejects.toThrow();

    expect(cardsOf({ queryClient }).c1!.status).toBe('stale');
    expect(notifyMutationError).not.toHaveBeenCalled();
    expect(invalidateForCards).not.toHaveBeenCalled();
  });

  it('toasts an error that carries no card', async () => {
    const queryClient = newClient();
    api.rejectChatProposal.mockRejectedValue(new Error('network'));
    const { result } = mountHook({ hook: () => useChatCardActions(), queryClient });

    await expect(result.reject.mutateAsync({ proposalId: 'c1' })).rejects.toThrow();

    expect(notifyMutationError).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackKey: 'chat.errors.cardAction' }),
    );
  });
});
