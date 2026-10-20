<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { useChatThreadList, useDeleteChatThread, useUpdateChatThread } from '@/composable/data-queries/chat';
import type { ChatThreadSearchHit } from '@bt/shared/types';
import { Loader2Icon, MessageSquareIcon, RotateCwIcon, SearchIcon, SquarePenIcon } from '@lucide/vue';
import { refDebounced } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { groupThreads } from './group-threads';
import ThreadListItem from './thread-list-item.vue';

defineProps<{
  /** The thread the page shows, marked in the list. */
  activeThreadId: string | null;
}>();

const emit = defineEmits<{
  select: [threadId: string];
  'new-chat': [];
  /** A thread was deleted; the page leaves it if it was the open one. */
  deleted: [threadId: string];
}>();

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_COUNT = 5;

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();

const searchInput = ref('');
const search = refDebounced(searchInput, SEARCH_DEBOUNCE_MS);
const isSearching = computed(() => search.value.trim() !== '');

const { threads, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useChatThreadList({
  search,
});
const updateThread = useUpdateChatThread();
const deleteThread = useDeleteChatThread();

const groups = computed(() => groupThreads({ threads: threads.value, isSearching: isSearching.value }));

// The mutations report their own failures with a toast; a caller only has to keep the rejection quiet.
const rename = async ({ thread, title }: { thread: ChatThreadSearchHit; title: string }) => {
  try {
    await updateThread.mutateAsync({ threadId: thread.id, payload: { title } });
    addSuccessNotification(t('chat.threads.toasts.renamed'));
  } catch {
    // Reported by the mutation.
  }
};

const togglePin = async ({ thread }: { thread: ChatThreadSearchHit }) => {
  const pinned = !thread.pinned;
  try {
    await updateThread.mutateAsync({ threadId: thread.id, payload: { pinned } });
    addSuccessNotification(t(pinned ? 'chat.threads.toasts.pinned' : 'chat.threads.toasts.unpinned'));
  } catch {
    // Reported by the mutation.
  }
};

const isDeleteOpen = ref(false);
const threadToDelete = ref<ChatThreadSearchHit | null>(null);

const askToDelete = ({ thread }: { thread: ChatThreadSearchHit }) => {
  threadToDelete.value = thread;
  isDeleteOpen.value = true;
};

const confirmDelete = async () => {
  const thread = threadToDelete.value;
  if (!thread) return;
  isDeleteOpen.value = false;

  try {
    await deleteThread.mutateAsync({ threadId: thread.id });
    addSuccessNotification(t('chat.threads.toasts.deleted'));
    emit('deleted', thread.id);
  } catch {
    // Reported by the mutation.
  }
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 p-3">
    <Button type="button" class="w-full" data-testid="new-chat" @click="emit('new-chat')">
      <SquarePenIcon class="size-4" aria-hidden="true" />
      {{ $t('chat.page.newChat') }}
    </Button>

    <InputField
      v-model="searchInput"
      type="search"
      :placeholder="$t('chat.threads.searchPlaceholder')"
      :aria-label="$t('chat.threads.searchPlaceholder')"
    >
      <template #iconLeading>
        <SearchIcon class="text-muted-foreground size-4" aria-hidden="true" />
      </template>
    </InputField>

    <ScrollArea class="min-h-0 flex-1">
      <div v-if="isLoading" class="flex flex-col gap-2" data-testid="threads-skeleton">
        <div v-for="index in SKELETON_COUNT" :key="index" class="bg-muted h-12 animate-pulse rounded-lg" />
      </div>

      <div v-else-if="isError && threads.length === 0" class="flex flex-col items-center gap-3 py-8 text-center">
        <p class="text-muted-foreground text-sm">{{ $t('chat.threads.loadError') }}</p>
        <Button variant="outline" size="sm" data-testid="retry" @click="refetch()">
          <RotateCwIcon class="size-4" aria-hidden="true" />
          {{ $t('common.actions.retry') }}
        </Button>
      </div>

      <div v-else-if="threads.length === 0" class="flex flex-col items-center gap-2 px-2 py-8 text-center">
        <template v-if="isSearching">
          <p class="text-muted-foreground text-sm">{{ $t('chat.threads.noResults', { query: search.trim() }) }}</p>
        </template>
        <template v-else>
          <MessageSquareIcon class="text-muted-foreground size-8" aria-hidden="true" />
          <p class="font-medium">{{ $t('chat.threads.emptyTitle') }}</p>
          <p class="text-muted-foreground text-sm">{{ $t('chat.threads.emptyDescription') }}</p>
        </template>
      </div>

      <div v-else class="flex flex-col gap-3">
        <section v-for="group in groups" :key="group.key" class="flex flex-col gap-1">
          <h3 class="text-muted-foreground px-3 text-xs font-medium" data-testid="group-heading">
            {{ $t(`chat.threads.${group.key}`) }}
          </h3>
          <ul class="flex flex-col gap-0.5">
            <ThreadListItem
              v-for="thread in group.threads"
              :key="thread.id"
              :thread="thread"
              :active="thread.id === activeThreadId"
              @select="emit('select', thread.id)"
              @rename="(title) => rename({ thread, title })"
              @toggle-pin="togglePin({ thread })"
              @delete="askToDelete({ thread })"
            />
          </ul>
        </section>

        <Button
          v-if="hasNextPage"
          variant="ghost"
          size="sm"
          class="self-center"
          data-testid="load-more"
          :disabled="isFetchingNextPage"
          @click="fetchNextPage()"
        >
          <Loader2Icon v-if="isFetchingNextPage" class="size-4 animate-spin" aria-hidden="true" />
          {{ $t('chat.threads.loadMore') }}
        </Button>
      </div>
    </ScrollArea>

    <ResponsiveAlertDialog
      v-model:open="isDeleteOpen"
      :confirm-label="$t('chat.threads.delete.confirm')"
      confirm-variant="destructive"
      @confirm="confirmDelete"
    >
      <template #title>{{ $t('chat.threads.delete.title') }}</template>
      <template #description>{{ $t('chat.threads.delete.description') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
