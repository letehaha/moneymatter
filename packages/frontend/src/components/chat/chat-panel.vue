<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { chatPageContextToQuery, useChatPageContext } from '@/composable/chat/use-chat-page-context';
import { useChatThread } from '@/composable/data-queries/chat';
import { ensureChunkLoaded } from '@/i18n';
import { ROUTES_NAMES } from '@/routes/constants';
import { CHAT_PANEL_MAX_WIDTH, CHAT_PANEL_MIN_WIDTH, useChatPanelStore } from '@/stores/chat-panel';
import { ExternalLinkIcon, SquarePenIcon, XIcon } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { hasChatContext } from './chat-context';
import ChatConversation from './chat-conversation.vue';
import ChatUsageChip from './chat-usage-chip.vue';

/** One arrow press on the resize handle. */
const KEYBOARD_STEP_PX = 16;

const router = useRouter();
const store = useChatPanelStore();
const { context } = useChatPageContext();
const { thread } = useChatThread({ threadId: computed(() => store.threadId) });

// The panel can open on any page, and its texts live in the Chat chunk, which only the Chat page loads.
const isReady = ref(false);
onMounted(async () => {
  await ensureChunkLoaded('pages/chat');
  isReady.value = true;
});

const openInPage = () => {
  const threadId = store.threadId;
  store.close();
  if (threadId) {
    void router.push({ name: ROUTES_NAMES.chatThread, params: { threadId } });
    return;
  }
  const currentContext = context.value;
  void router.push({
    name: ROUTES_NAMES.chat,
    ...(currentContext && hasChatContext({ context: currentContext })
      ? { query: chatPageContextToQuery({ context: currentContext }) }
      : {}),
  });
};

// The handle sits on the panel's left edge: dragging left makes the panel wider.
let dragStart: { pointerX: number; width: number } | null = null;

const onResizePointerDown = (event: PointerEvent) => {
  dragStart = { pointerX: event.clientX, width: store.width };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
};

const onResizePointerMove = (event: PointerEvent) => {
  if (!dragStart) return;
  store.setWidth(dragStart.width + (dragStart.pointerX - event.clientX));
};

const onResizePointerUp = (event: PointerEvent) => {
  dragStart = null;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
};

const onResizeKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowLeft') store.setWidth(store.width + KEYBOARD_STEP_PX);
  else if (event.key === 'ArrowRight') store.setWidth(store.width - KEYBOARD_STEP_PX);
  else return;
  event.preventDefault();
};
</script>

<template>
  <aside
    class="bg-background relative flex h-full shrink-0 flex-col border-l"
    data-testid="chat-panel"
    :style="{ width: `${store.width}px` }"
    :aria-label="isReady ? $t('chat.panel.title') : undefined"
  >
    <div
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      class="hover:bg-primary/30 focus-visible:bg-primary/40 absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-hidden"
      data-testid="panel-resize"
      :aria-label="$t('chat.panel.resize')"
      :aria-valuemin="CHAT_PANEL_MIN_WIDTH"
      :aria-valuemax="CHAT_PANEL_MAX_WIDTH"
      :aria-valuenow="store.width"
      @pointerdown="onResizePointerDown"
      @pointermove="onResizePointerMove"
      @pointerup="onResizePointerUp"
      @keydown="onResizeKeydown"
    />

    <template v-if="isReady">
      <header class="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <h2 class="min-w-0 flex-1 truncate text-sm font-semibold" data-testid="panel-title">
          {{ thread?.title || $t('chat.panel.title') }}
        </h2>
        <ChatUsageChip v-if="thread" :usage="thread.usage" />

        <DesktopOnlyTooltip :content="$t('chat.panel.newChat')">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="panel-new-chat"
            :aria-label="$t('chat.panel.newChat')"
            @click="store.setThread({ threadId: null })"
          >
            <SquarePenIcon class="size-4" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip :content="$t('chat.panel.openInPage')">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="panel-open-page"
            :aria-label="$t('chat.panel.openInPage')"
            @click="openInPage"
          >
            <ExternalLinkIcon class="size-4" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip :content="$t('chat.panel.close')">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="panel-close"
            :aria-label="$t('chat.panel.close')"
            @click="store.close()"
          >
            <XIcon class="size-4" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
      </header>

      <div class="min-h-0 flex-1">
        <ChatConversation
          :thread-id="store.threadId"
          :context="context"
          @thread-created="(threadId) => store.setThread({ threadId })"
        />
      </div>
    </template>
    <div v-else class="flex flex-col gap-3 p-4" aria-hidden="true">
      <div class="bg-muted h-4 w-1/2 animate-pulse rounded" />
      <div class="bg-muted/60 h-4 w-3/4 animate-pulse rounded" />
    </div>
  </aside>
</template>
