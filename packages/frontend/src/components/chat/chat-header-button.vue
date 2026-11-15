<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { chatPageContextToQuery, useChatPageContext } from '@/composable/chat/use-chat-page-context';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { ROUTES_NAMES } from '@/routes/constants';
import { useChatPanelStore } from '@/stores/chat-panel';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { hasChatContext } from './chat-context';
import { AiChatIcon } from './chat-icon';

const route = useRoute();
const router = useRouter();
const panel = useChatPanelStore();
const { context } = useChatPageContext();
const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

// The Chat page is the conversation itself; a button to open it would only compete with it.
const isOnChatPage = computed(() => route.name === ROUTES_NAMES.chat || route.name === ROUTES_NAMES.chatThread);

/**
 * A wide screen docks the panel beside the page, which keeps the page and its context in view. A
 * narrow one has no room for that, so the button opens the Chat page and carries the context along.
 */
const onClick = () => {
  if (!isMobileView.value) {
    panel.toggle();
    return;
  }

  const current = context.value;
  void router.push({
    name: ROUTES_NAMES.chat,
    ...(current && hasChatContext({ context: current }) ? { query: chatPageContextToQuery({ context: current }) } : {}),
  });
};
</script>

<template>
  <DesktopOnlyTooltip v-if="!isOnChatPage" :content="$t('header.chat')">
    <Button
      variant="secondary"
      size="icon"
      data-testid="chat-header-button"
      :aria-label="$t('header.chat')"
      :aria-pressed="isMobileView ? undefined : panel.isOpen"
      @click="onClick"
    >
      <AiChatIcon class="size-4" aria-hidden="true" />
    </Button>
  </DesktopOnlyTooltip>
</template>
