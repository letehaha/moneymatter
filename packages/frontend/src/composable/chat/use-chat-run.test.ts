import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { ChatRunEvent } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

import { useChatRun } from './use-chat-run';

const streamChatRunEvents = vi.fn();
const sendChatMessage = vi.fn();
const cancelChatRun = vi.fn();

vi.mock('@/api/chat', () => ({
  streamChatRunEvents: (...args: unknown[]) => streamChatRunEvents(...args),
  sendChatMessage: (...args: unknown[]) => sendChatMessage(...args),
  cancelChatRun: (...args: unknown[]) => cancelChatRun(...args),
}));

const THREAD_ID = 'thread-1';
const RUN = { runId: 'run-1', messageId: 'msg-1' };

type StreamArgs = { runId: string; signal: AbortSignal; onEvent: (event: ChatRunEvent) => void };

/** A stream the test drives by hand: `emit` delivers an event, `end` settles the stream call. */
const manualStream = () => {
  let args!: StreamArgs;
  let end!: (outcome: 'finished' | 'aborted' | 'failed') => void;
  streamChatRunEvents.mockImplementationOnce((received: StreamArgs) => {
    args = received;
    return new Promise((resolve) => {
      end = resolve;
    });
  });
  return {
    emit: (event: ChatRunEvent) => args.onEvent(event),
    end: (outcome: 'finished' | 'aborted' | 'failed') => end(outcome),
    args: () => args,
  };
};

/** A stream that replays `events` at once and finishes. */
const replayedStream = ({
  events,
  outcome = 'finished',
}: {
  events: ChatRunEvent[];
  outcome?: 'finished' | 'failed';
}) => {
  streamChatRunEvents.mockImplementationOnce(async ({ onEvent }: StreamArgs) => {
    events.forEach(onEvent);
    return outcome;
  });
};

const mountRun = ({ threadId = THREAD_ID }: { threadId?: string | null } = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const threadIdRef = ref<string | null>(threadId);
  let chatRun!: ReturnType<typeof useChatRun>;
  const wrapper = mount(
    defineComponent({
      setup() {
        chatRun = useChatRun({ threadId: threadIdRef });
        return () => null;
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return { chatRun, invalidateQueries, threadIdRef, wrapper };
};

const threadKey = [...VUE_QUERY_CACHE_KEYS.chatThread, THREAD_ID];

beforeEach(() => {
  vi.clearAllMocks();
  streamChatRunEvents.mockReset();
});

describe('useChatRun', () => {
  it('applies the events of the run in the order they arrive', async () => {
    const stream = manualStream();
    const { chatRun } = mountRun();

    void chatRun.attach(RUN);
    await flushPromises();
    expect(chatRun.run.value).toMatchObject({ ...RUN, status: 'streaming', parts: [] });
    expect(chatRun.isStreaming.value).toBe(true);

    stream.emit({ type: 'run.started', runId: RUN.runId, messageId: RUN.messageId, provider: 'openai', modelId: 'm' });
    stream.emit({ type: 'part.started', part: { type: 'text', id: 'a', text: '' } });
    stream.emit({ type: 'text.delta', partId: 'a', delta: 'Hel' });
    stream.emit({ type: 'text.delta', partId: 'a', delta: 'lo' });

    expect(chatRun.run.value?.parts).toEqual([{ type: 'text', id: 'a', text: 'Hello' }]);
    expect(chatRun.run.value?.modelId).toBe('m');
  });

  it('removes the parts a retraction names', async () => {
    const stream = manualStream();
    const { chatRun } = mountRun();

    void chatRun.attach(RUN);
    await flushPromises();
    stream.emit({ type: 'part.started', part: { type: 'text', id: 'a', text: 'let me look' } });
    stream.emit({ type: 'text.retracted', partIds: ['a'] });
    stream.emit({ type: 'part.started', part: { type: 'proposal', id: 'b', proposalId: 'p1' } });

    expect(chatRun.run.value?.parts).toEqual([{ type: 'proposal', id: 'b', proposalId: 'p1' }]);
  });

  it('stops following the run when it finishes, however it ended, and reads the thread', async () => {
    for (const status of ['complete', 'interrupted'] as const) {
      const { chatRun, invalidateQueries } = mountRun();
      replayedStream({
        events: [
          { type: 'part.started', part: { type: 'text', id: 'a', text: 'partial' } },
          { type: 'run.finished', status },
        ],
      });

      await chatRun.attach(RUN);

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: threadKey });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: VUE_QUERY_CACHE_KEYS.chatThreads });
      expect(chatRun.run.value).toBeNull();
      expect(chatRun.isStreaming.value).toBe(false);
    }
  });

  it('keeps the finished run on screen until the thread has been read', async () => {
    const refetches: Array<() => void> = [];
    const { chatRun, invalidateQueries } = mountRun();
    invalidateQueries.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          refetches.push(resolve);
        }),
    );
    replayedStream({
      events: [
        { type: 'part.started', part: { type: 'text', id: 'a', text: 'answer' } },
        { type: 'run.finished', status: 'complete' },
      ],
    });

    const attached = chatRun.attach(RUN);
    await flushPromises();

    expect(chatRun.run.value).toMatchObject({ status: 'complete', parts: [{ id: 'a', text: 'answer' }] });
    expect(chatRun.isStreaming.value).toBe(false);

    refetches.forEach((finish) => finish());
    await attached;
    expect(chatRun.run.value).toBeNull();
  });

  it('reads the thread instead when the stream is gone', async () => {
    const { chatRun, invalidateQueries } = mountRun();
    replayedStream({ events: [], outcome: 'failed' });

    await chatRun.attach(RUN);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: threadKey });
    expect(chatRun.run.value).toBeNull();
  });

  it('reads the thread when only the closing event of an expired stream arrives', async () => {
    const { chatRun, invalidateQueries } = mountRun();
    replayedStream({ events: [{ type: 'run.finished', status: 'cancelled' }] });

    await chatRun.attach(RUN);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: threadKey });
    expect(chatRun.run.value).toBeNull();
  });

  it('cancels through the API and keeps following until the run finishes', async () => {
    const stream = manualStream();
    cancelChatRun.mockResolvedValue({ runId: RUN.runId, status: 'streaming' });
    const { chatRun } = mountRun();

    void chatRun.attach(RUN);
    await flushPromises();
    await chatRun.cancel();

    expect(cancelChatRun).toHaveBeenCalledWith({ runId: RUN.runId });
    expect(stream.args().signal.aborted).toBe(false);
    stream.emit({ type: 'run.finished', status: 'cancelled' });
    expect(chatRun.run.value?.status).toBe('cancelled');
  });

  it('does nothing when asked to cancel without a run', async () => {
    const { chatRun } = mountRun();

    await chatRun.cancel();

    expect(cancelChatRun).not.toHaveBeenCalled();
  });

  it('sends a message, shows it, and follows the run it started', async () => {
    sendChatMessage.mockResolvedValue({ ...RUN, userMessageId: 'u1' });
    const stream = manualStream();
    const { chatRun, invalidateQueries } = mountRun();

    const response = await chatRun.send({ payload: { text: 'Where did my money go?' } });
    await flushPromises();

    expect(sendChatMessage).toHaveBeenCalledWith({ threadId: THREAD_ID, payload: { text: 'Where did my money go?' } });
    expect(response.runId).toBe(RUN.runId);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: threadKey });
    expect(stream.args().runId).toBe(RUN.runId);
    expect(chatRun.run.value).toMatchObject(RUN);
  });

  it('does not send without a thread', async () => {
    const { chatRun } = mountRun({ threadId: null });

    await expect(chatRun.send({ payload: { text: 'hi' } })).rejects.toThrow();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('follows only the latest run when a new one is attached', async () => {
    const first = manualStream();
    const { chatRun } = mountRun();

    void chatRun.attach(RUN);
    await flushPromises();
    const second = manualStream();
    void chatRun.attach({ runId: 'run-2', messageId: 'msg-2' });
    await flushPromises();

    expect(first.args().signal.aborted).toBe(true);
    first.emit({ type: 'part.started', part: { type: 'text', id: 'late', text: 'stale' } });
    expect(chatRun.run.value).toMatchObject({ runId: 'run-2', parts: [] });
    second.emit({ type: 'part.started', part: { type: 'text', id: 'a', text: 'fresh' } });
    expect(chatRun.run.value?.parts).toHaveLength(1);
  });

  it('stops following when the thread changes and when the component goes away', async () => {
    const stream = manualStream();
    const { chatRun, threadIdRef, wrapper } = mountRun();

    void chatRun.attach(RUN);
    await flushPromises();
    threadIdRef.value = 'thread-2';
    await flushPromises();

    expect(stream.args().signal.aborted).toBe(true);
    expect(chatRun.run.value).toBeNull();

    const another = manualStream();
    void chatRun.attach({ runId: 'run-3', messageId: 'msg-3' });
    await flushPromises();
    wrapper.unmount();

    expect(another.args().signal.aborted).toBe(true);
  });
});
