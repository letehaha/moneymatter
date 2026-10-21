<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useChatRun } from '@/composable/chat/use-chat-run';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import {
  useChatDefaultConnection,
  useChatThread,
  useCreateChatThread,
  useUpdateChatThread,
} from '@/composable/data-queries/chat';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import {
  AI_FEATURE,
  type ChatClarificationAnswerInput,
  type ChatCreateThreadRequest,
  type ChatMessage as ChatMessageModel,
  type ChatPageContext,
  type ChatSendMessageRequest,
  type ChatSendMessageResponse,
} from '@bt/shared/types';
import { Loader2Icon, RotateCwIcon } from '@lucide/vue';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import ChatComposer from './chat-composer.vue';
import ChatConnectionPicker from './chat-connection-picker.vue';
import { isSameChatContext, toThreadContext } from './chat-context';
import ChatContextChip from './chat-context-chip.vue';
import { useChatContextLabel } from './chat-context-label';
import ChatEmptyState from './chat-empty-state.vue';
import ChatMessage from './chat-message.vue';

const props = defineProps<{
  /** The thread to show; `null` is a conversation that has not started. */
  threadId: string | null;
  /**
   * The page the user is on. A conversation that has not started takes it as its context; one that has keeps
   * its own and only offers this one as a switch. Null on the Chat page, whose new conversations start without.
   */
  context: ChatPageContext | null;
}>();

const emit = defineEmits<{ 'thread-created': [threadId: string] }>();

/** How close to the end of the conversation counts as "following it". */
const NEAR_BOTTOM_PX = 80;
const SKELETON_COUNT = 3;

// The thread is created on the first message (or the first attachment), so the conversation can hold an
// id the page has not heard of yet; the page catches up through `thread-created`.
const activeThreadId = ref(props.threadId);
// A pick belongs to the thread it was made for, so another thread starts without one.
const pickedConnectionId = ref<string | null | undefined>(undefined);
// The model picked within the connection; null is the connection's own model.
const pickedModelId = ref<string | null | undefined>(undefined);
watch(
  () => props.threadId,
  (id) => {
    if (id !== activeThreadId.value) {
      pickedConnectionId.value = undefined;
      pickedModelId.value = undefined;
    }
    activeThreadId.value = id;
  },
);

const { thread, messages, cards, hasMore, isLoading, isError, isLoadingOlder, loadOlder, refetch } = useChatThread({
  threadId: activeThreadId,
});
const chatRun = useChatRun({ threadId: activeThreadId });
const createThread = useCreateChatThread();
const updateThread = useUpdateChatThread();
const { getFeatureStatus } = useAiSettings();

const composerRef = ref<InstanceType<typeof ChatComposer> | null>(null);
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const isSending = ref(false);

const { label: contextLabel } = useChatContextLabel();

// A conversation that has not started follows the page it is on; removing the chip drops that page until
// another one comes along. Once it has started, its context is the stored one, whatever page it is opened on.
const dismissedPage = ref<ChatPageContext | null>(null);
const createdWithContext = ref<ChatPageContext | null>(null);
const currentPage = computed(() => (props.context ? toThreadContext({ context: props.context }) : null));
const threadContext = computed<ChatPageContext | null>(() => {
  if (activeThreadId.value === null) {
    const isDismissed =
      dismissedPage.value !== null && isSameChatContext({ a: dismissedPage.value, b: currentPage.value });
    return isDismissed ? null : currentPage.value;
  }
  // Until the stored thread has loaded, the conversation shows the context it was created with.
  return thread.value ? thread.value.pageContext : createdWithContext.value;
});
const threadContextLabel = computed(() =>
  threadContext.value ? contextLabel({ context: threadContext.value, names: thread.value?.pageContextNames }) : null,
);
const canUseCurrentPage = computed(() => {
  if (activeThreadId.value === null || !thread.value || !currentPage.value) return false;
  if (contextLabel({ context: currentPage.value }) === null) return false;
  return !isSameChatContext({ a: currentPage.value, b: thread.value.pageContext });
});

const onRemoveContext = async () => {
  if (activeThreadId.value === null) {
    dismissedPage.value = currentPage.value;
    return;
  }
  await updateThread.mutateAsync({ threadId: activeThreadId.value, payload: { pageContext: null } }).catch(() => {
    // The mutation reports the failure; the chip stays.
  });
};

const onUseCurrentPage = async () => {
  if (activeThreadId.value === null || !currentPage.value) return;
  await updateThread
    .mutateAsync({ threadId: activeThreadId.value, payload: { pageContext: currentPage.value } })
    .catch(() => {
      // The mutation reports the failure; the thread keeps its page.
    });
};

/** A feature whose status is not known yet is treated as configured: a slow answer must not flash "connect a model". */
const isConfigured = computed(() => {
  const status = getFeatureStatus(AI_FEATURE.chat);
  return status ? status.servedBy !== null : true;
});

const run = chatRun.run;

const liveAssistantMessage = ({ id }: { id: string }): ChatMessageModel => ({
  id,
  threadId: activeThreadId.value ?? '',
  role: 'assistant',
  status: 'streaming',
  parts: [],
  plainText: null,
  pageContext: null,
  runId: null,
  provider: null,
  modelId: null,
  promptVersion: null,
  usage: null,
  stepCount: 0,
  error: null,
  createdAt: new Date().toISOString(),
});

/** What the live run has produced stands in for the stored message of the same id, which fills in when the run ends. */
const displayMessages = computed<ChatMessageModel[]>(() => {
  const live = run.value;
  if (!live) return messages.value;

  const withRun = (message: ChatMessageModel): ChatMessageModel => ({
    ...message,
    status: live.status,
    parts: live.parts,
    error: live.error ?? message.error,
  });
  const stored = messages.value.some((message) => message.id === live.messageId);
  return stored
    ? messages.value.map((message) => (message.id === live.messageId ? withRun(message) : message))
    : [...messages.value, withRun(liveAssistantMessage({ id: live.messageId }))];
});

const displayCards = computed(() => ({ ...cards.value, ...run.value?.cards }));

const isBusy = computed(
  () =>
    chatRun.isStreaming.value ||
    isSending.value ||
    messages.value.some((message) => message.role === 'assistant' && message.status === 'streaming'),
);

// The connection the next message runs on. Before the thread exists the user's pick (or, without one,
// the default the server would choose) is shown and sent with the create call; the picked value stays
// until the stored thread has loaded. A pick on an existing thread is shown until the server confirms it.
const { data: defaultConnection } = useChatDefaultConnection({
  enabled: computed(() => activeThreadId.value === null),
});
const shownConnectionId = computed<string | null>(() => {
  if (pickedConnectionId.value !== undefined) return pickedConnectionId.value;
  if (thread.value) return thread.value.connectionId;
  return activeThreadId.value === null ? (defaultConnection.value?.connectionId ?? null) : null;
});
const shownModelId = computed<string | null>(() => {
  if (pickedModelId.value !== undefined) return pickedModelId.value;
  if (thread.value) return thread.value.modelId;
  return activeThreadId.value === null ? (defaultConnection.value?.modelId ?? null) : null;
});
// The stored thread is the source of truth once it has loaded.
watch(thread, (loaded) => {
  if (loaded && !updateThread.isPending.value) {
    pickedConnectionId.value = undefined;
    pickedModelId.value = undefined;
  }
});

const onPickConnection = async ({ connectionId }: { connectionId: string | null }) => {
  const previous = { connectionId: pickedConnectionId.value, modelId: pickedModelId.value };
  pickedConnectionId.value = connectionId;
  // A model belongs to its connection: the new one starts on its own model.
  pickedModelId.value = null;
  if (!activeThreadId.value) return;

  try {
    await updateThread.mutateAsync({ threadId: activeThreadId.value, payload: { connectionId } });
  } catch {
    // The mutation reports the failure; the picker goes back to the stored connection and model.
    pickedConnectionId.value = previous.connectionId;
    pickedModelId.value = previous.modelId;
    return;
  }
  pickedConnectionId.value = undefined;
  pickedModelId.value = undefined;
};

const onPickModel = async ({ modelId }: { modelId: string | null }) => {
  const previous = pickedModelId.value;
  pickedModelId.value = modelId;
  if (!activeThreadId.value) return;

  try {
    await updateThread.mutateAsync({ threadId: activeThreadId.value, payload: { modelId } });
  } catch {
    pickedModelId.value = previous;
    return;
  }
  pickedModelId.value = undefined;
};

/**
 * What the first message creates the thread with. A model rides on the connection it was picked for, so a
 * model picked on the connection shown by default names that connection too. Choosing the connection default
 * is sent as an explicit null: left out, the new thread would inherit the model of the latest one.
 */
const buildCreateRequest = (): ChatCreateThreadRequest => {
  const modelId = pickedModelId.value;
  const connectionId =
    pickedConnectionId.value !== undefined
      ? pickedConnectionId.value
      : typeof modelId === 'string'
        ? shownConnectionId.value
        : undefined;

  return {
    ...(connectionId === undefined ? {} : { connectionId }),
    ...(modelId === undefined ? {} : { modelId }),
    ...(threadContext.value && threadContextLabel.value !== null ? { pageContext: threadContext.value } : {}),
  };
};

const isLive = ({ message }: { message: ChatMessageModel }) =>
  run.value?.status === 'streaming' && run.value.messageId === message.id;

const hasContent = computed(() => displayMessages.value.length > 0);
const showSkeleton = computed(() => isLoading.value && !hasContent.value && activeThreadId.value !== null);
const showError = computed(() => isError.value && !hasContent.value);
const showEmpty = computed(() => !hasContent.value && !showSkeleton.value && !showError.value);

// A reload while an answer was streaming: follow the run that is still going.
const followedRunIds = new Set<string>();
watch(
  messages,
  (list) => {
    if (run.value) return;
    const pending = list.findLast((message) => message.role === 'assistant' && message.status === 'streaming');
    if (!pending?.runId || followedRunIds.has(pending.runId)) return;
    followedRunIds.add(pending.runId);
    void chatRun.attach({ runId: pending.runId, messageId: pending.id });
  },
  { immediate: true },
);

let creatingThread: Promise<string> | null = null;

const ensureThread = (): Promise<string> => {
  if (activeThreadId.value) return Promise.resolve(activeThreadId.value);

  // Two attachments dropped together must not create two threads.
  creatingThread ??= createThread
    .mutateAsync(buildCreateRequest())
    .then((created) => {
      createdWithContext.value = created.pageContext ?? null;
      activeThreadId.value = created.id;
      // The stored thread is still loading; until it has, the picker names the connection it was created on.
      pickedConnectionId.value = created.connectionId;
      pickedModelId.value = created.modelId;
      emit('thread-created', created.id);
      return created.id;
    })
    .finally(() => {
      creatingThread = null;
    });
  return creatingThread;
};

const sendPayload = async ({ payload }: { payload: ChatSendMessageRequest }) => {
  isSending.value = true;
  isPinnedToBottom.value = true;
  try {
    await ensureThread();
    // The run composable follows the thread id; let it see the new one before the first message.
    await nextTick();
    await chatRun.send({ payload });
  } catch (error) {
    notifyMutationError({ error, fallbackKey: 'chat.errors.sendFailed' });
  } finally {
    isSending.value = false;
  }
};

const onSend = ({ text, attachmentIds }: { text: string; attachmentIds: string[] }) =>
  sendPayload({ payload: { text, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) } });

const onAnswer = ({ answer }: { answer: ChatClarificationAnswerInput }) =>
  sendPayload({ payload: { text: '', clarificationAnswer: answer } });

/** A comment on a card starts a run like a message does: show it and follow it. */
const onCommented = async ({ response }: { response: ChatSendMessageResponse }) => {
  isPinnedToBottom.value = true;
  await refetch();
  void chatRun.attach({ runId: response.runId, messageId: response.messageId });
};

const fillComposer = ({ text }: { text: string }) => composerRef.value?.fill({ text });

// Stay with the end of the conversation while it grows, unless the user scrolled up to read.
const isPinnedToBottom = ref(true);
const viewportElement = () => scrollAreaRef.value?.viewportRef?.viewportElement as HTMLElement | undefined;

const onScroll = () => {
  const element = viewportElement();
  if (!element) return;
  isPinnedToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
};

const scrollToBottom = async () => {
  await nextTick();
  const element = viewportElement();
  if (element) element.scrollTop = element.scrollHeight;
};

const contentSignature = computed(
  () =>
    displayMessages.value
      .map((message) => {
        const last = message.parts.at(-1);
        return `${message.id}:${message.parts.length}:${last && last.type === 'text' ? last.text.length : 0}`;
      })
      .join('|') + Object.keys(displayCards.value).length,
);

watch(contentSignature, () => {
  if (isPinnedToBottom.value) void scrollToBottom();
});
watch(activeThreadId, () => {
  isPinnedToBottom.value = true;
});
onMounted(scrollToBottom);
</script>

<template>
  <div class="@container/chat-conversation flex h-full min-h-0 flex-col">
    <ChatConnectionPicker
      :connection-id="shownConnectionId"
      :model-id="shownModelId"
      :disabled="isBusy || updateThread.isPending.value"
      @select="(connectionId) => onPickConnection({ connectionId })"
      @select-model="(modelId) => onPickModel({ modelId })"
    >
      <template v-if="threadContextLabel || canUseCurrentPage" #default>
        <ChatContextChip
          :label="threadContextLabel"
          :can-use-current-page="canUseCurrentPage"
          @remove="onRemoveContext"
          @use-current-page="onUseCurrentPage"
        />
      </template>
    </ChatConnectionPicker>

    <ScrollArea ref="scrollAreaRef" class="min-h-0 flex-1" :scroll-y="onScroll">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-3 py-4 @sm/chat-conversation:px-5">
        <div v-if="showSkeleton" class="flex flex-col gap-4" data-testid="conversation-skeleton">
          <div v-for="index in SKELETON_COUNT" :key="index" class="flex flex-col gap-2">
            <div class="bg-muted h-4 w-3/4 animate-pulse rounded" />
            <div class="bg-muted/60 h-4 w-1/2 animate-pulse rounded" />
          </div>
        </div>

        <div v-else-if="showError" class="flex flex-col items-center gap-3 py-10 text-center">
          <p class="text-muted-foreground text-sm">{{ $t('chat.conversation.loadError') }}</p>
          <Button variant="outline" data-testid="retry" @click="refetch()">
            <RotateCwIcon class="size-4" aria-hidden="true" />
            {{ $t('common.actions.retry') }}
          </Button>
        </div>

        <ChatEmptyState
          v-else-if="showEmpty"
          :is-configured="isConfigured"
          @prompt="(text) => fillComposer({ text })"
        />

        <template v-else>
          <Button
            v-if="hasMore"
            variant="ghost"
            size="sm"
            class="self-center"
            data-testid="load-older"
            :disabled="isLoadingOlder"
            @click="loadOlder()"
          >
            <Loader2Icon v-if="isLoadingOlder" class="size-4 animate-spin" aria-hidden="true" />
            {{ $t('chat.conversation.loadOlder') }}
          </Button>

          <ChatMessage
            v-for="message in displayMessages"
            :key="message.id"
            :message="message"
            :cards="displayCards"
            :is-live="isLive({ message })"
            :can-answer="!isBusy"
            @answer="(answer) => onAnswer({ answer })"
            @commented="(response) => onCommented({ response })"
          />
        </template>
      </div>
    </ScrollArea>

    <div class="mx-auto w-full max-w-3xl shrink-0">
      <ChatComposer
        ref="composerRef"
        :is-streaming="chatRun.isStreaming.value"
        :disabled="!isConfigured"
        :ensure-thread="ensureThread"
        @send="onSend"
        @cancel="chatRun.cancel()"
      />
    </div>
  </div>
</template>
