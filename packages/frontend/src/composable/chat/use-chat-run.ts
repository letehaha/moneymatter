import { cancelChatRun, sendChatMessage, streamChatRunEvents } from '@/api/chat';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { ChatSendMessageRequest, ChatSendMessageResponse } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, onScopeDispose, shallowRef, toValue, watch } from 'vue';

import { type ChatRunState, applyRunEvent, createRunState } from './apply-run-event';

/**
 * Follows the run of one thread. `run` holds what the run has produced so far, built from its
 * events; the conversation shows it in place of the stored message of the same id while the run is
 * live. When the run ends (or its stream cannot be followed) the thread is read again, which brings
 * the final message and its cards, and `run` is cleared.
 *
 * A reload attaches to the run of a message that is still `streaming`: the stream replays from its
 * start, so the state is rebuilt whole.
 */
export const useChatRun = ({ threadId }: { threadId: MaybeRefOrGetter<string | null> }) => {
  const queryClient = useQueryClient();
  const run = shallowRef<ChatRunState | null>(null);
  let current: AbortController | null = null;

  const isStreaming = computed(() => run.value?.status === 'streaming');

  /** Stops following the current run, without telling the server: the run itself carries on. */
  const stop = () => {
    current?.abort();
    current = null;
    run.value = null;
  };

  const refreshThread = async ({ id }: { id: string }) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.chatThread, id] }),
      // The run may have titled the thread and moved it up the list.
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.chatThreads }),
    ]);
  };

  const attach = async ({ runId, messageId }: { runId: string; messageId: string }): Promise<void> => {
    const id = toValue(threadId);
    if (!id) return;

    stop();
    const controller = new AbortController();
    current = controller;
    run.value = createRunState({ runId, messageId });

    const outcome = await streamChatRunEvents({
      runId,
      signal: controller.signal,
      onEvent: (event) => {
        // An event of a run that was replaced or stopped must not leak into the new state.
        if (controller.signal.aborted || !run.value) return;
        run.value = applyRunEvent({ state: run.value, event });
      },
    });

    if (outcome === 'aborted') return;

    // The stored message is final before `run.finished` is sent, so reading the thread is enough, and
    // it is the only source left when the stream has expired or cannot be reached.
    await refreshThread({ id });
    if (current === controller) {
      current = null;
      run.value = null;
    }
  };

  const send = async ({ payload }: { payload: ChatSendMessageRequest }): Promise<ChatSendMessageResponse> => {
    const id = toValue(threadId);
    if (!id) throw new Error('A message needs a thread');

    const response = await sendChatMessage({ threadId: id, payload });
    // The user's message and the empty answer exist already; show them while the run streams.
    void queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.chatThread, id] });
    void attach({ runId: response.runId, messageId: response.messageId });
    return response;
  };

  const cancel = async (): Promise<void> => {
    const live = run.value;
    if (!live || live.status !== 'streaming') return;
    // The run ends with `run.finished { status: 'cancelled' }`, which the stream still delivers.
    await cancelChatRun({ runId: live.runId });
  };

  watch(
    () => toValue(threadId),
    () => stop(),
  );
  onScopeDispose(stop);

  return { run, isStreaming, send, attach, cancel, stop };
};
