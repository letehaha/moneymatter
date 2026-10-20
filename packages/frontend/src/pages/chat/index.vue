<script setup lang="ts">
import ChatConversation from '@/components/chat/chat-conversation.vue';
import ChatUsageChip from '@/components/chat/chat-usage-chip.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { chatPageContextFromQuery } from '@/composable/chat/use-chat-page-context';
import { useChatThread } from '@/composable/data-queries/chat';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { HistoryIcon, SquarePenIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ThreadList from './components/thread-list.vue';

defineOptions({ name: 'chat-page' });

const route = useRoute();
const router = useRouter();
const { format } = useDateLocale();

const threadId = computed(() => {
  const param = route.params.threadId;
  const value = Array.isArray(param) ? param[0] : param;
  return value || null;
});

const { thread } = useChatThread({ threadId });

// The mobile header button opens this page with the page it was pressed on in the route.
const context = computed(() => chatPageContextFromQuery({ query: route.query }));

// Below the page's two-column width the list is a pane the header button toggles.
const isHistoryOpen = ref(false);

const expiryText = computed(() => {
  if (!thread.value) return null;
  const { expiresAt } = thread.value;
  return expiresAt
    ? { key: 'chat.threads.expiresOn', date: format(new Date(expiresAt), 'PP') }
    : { key: 'chat.threads.neverExpires' };
});

const openThread = ({ id }: { id: string }) => {
  isHistoryOpen.value = false;
  void router.push({ name: ROUTES_NAMES.chatThread, params: { threadId: id } });
};

const startNewChat = () => {
  isHistoryOpen.value = false;
  void router.push({ name: ROUTES_NAMES.chat });
};

// The first message creates the thread; the page moves to its address without a history entry of its own.
const onThreadCreated = ({ id }: { id: string }) => {
  void router.replace({ name: ROUTES_NAMES.chatThread, params: { threadId: id } });
};

const onThreadDeleted = ({ id }: { id: string }) => {
  if (id === threadId.value) void router.replace({ name: ROUTES_NAMES.chat });
};
</script>

<template>
  <div
    class="@container/chat relative flex h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height,0px))] min-h-0"
  >
    <aside
      data-testid="history-pane"
      :class="
        cn(
          'bg-background absolute inset-0 z-20 flex-col border-r @3xl/chat:static @3xl/chat:z-auto @3xl/chat:flex @3xl/chat:w-72 @3xl/chat:shrink-0',
          isHistoryOpen ? 'flex' : 'hidden',
        )
      "
    >
      <ThreadList
        :active-thread-id="threadId"
        @select="(id) => openThread({ id })"
        @new-chat="startNewChat"
        @deleted="(id) => onThreadDeleted({ id })"
      />
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-2">
        <DesktopOnlyTooltip :content="$t('chat.page.history')">
          <Button
            variant="ghost"
            size="icon-sm"
            class="@3xl/chat:hidden"
            data-testid="history-toggle"
            :aria-label="$t('chat.page.history')"
            :aria-expanded="isHistoryOpen"
            @click="isHistoryOpen = !isHistoryOpen"
          >
            <HistoryIcon class="size-4" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>

        <div class="flex min-w-0 flex-1 flex-col">
          <h1 class="truncate text-sm font-semibold" data-testid="chat-title">
            {{ thread?.title || $t('chat.title') }}
          </h1>
          <p v-if="expiryText" class="text-muted-foreground truncate text-xs" data-testid="chat-expiry">
            {{ $t(expiryText.key, { date: expiryText.date ?? '' }) }}
          </p>
        </div>

        <ChatUsageChip v-if="thread" :usage="thread.usage" />

        <DesktopOnlyTooltip :content="$t('chat.page.newChat')">
          <Button
            variant="ghost"
            size="icon-sm"
            class="@3xl/chat:hidden"
            data-testid="header-new-chat"
            :aria-label="$t('chat.page.newChat')"
            @click="startNewChat"
          >
            <SquarePenIcon class="size-4" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
      </header>

      <div class="min-h-0 flex-1">
        <ChatConversation
          :thread-id="threadId"
          :context="threadId ? null : context"
          @thread-created="(id) => onThreadCreated({ id })"
        />
      </div>
    </section>
  </div>
</template>
