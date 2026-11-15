<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useChatText } from '@/components/chat/chat-text';
import { useChatAppliedCards } from '@/composable/data-queries/chat';
import { useDateLocale } from '@/composable/use-date-locale';
import { ROUTES_NAMES } from '@/routes/constants';
import { ChevronLeftIcon, CircleCheckIcon, Loader2Icon, RotateCwIcon } from '@lucide/vue';
import { computed } from 'vue';

defineOptions({ name: 'settings-ai-chat-applied' });

const SKELETON_COUNT = 4;

const { titleText } = useChatText();
const { format } = useDateLocale();
const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useChatAppliedCards();

const items = computed(() => data.value?.pages.flatMap((page) => page.items) ?? []);

const appliedAt = ({ iso }: { iso: string | undefined }) => (iso ? format(new Date(iso), 'PPp') : '');
</script>

<template>
  <div class="flex flex-col gap-4">
    <RouterLink
      :to="{ name: ROUTES_NAMES.settingsAiFeatures }"
      class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
    >
      <ChevronLeftIcon class="size-4" aria-hidden="true" />
      {{ $t('settings.ai.chat.applied.back') }}
    </RouterLink>

    <div>
      <h3 class="text-lg font-medium">{{ $t('settings.ai.chat.applied.title') }}</h3>
      <p class="text-muted-foreground text-sm">{{ $t('settings.ai.chat.applied.description') }}</p>
    </div>

    <div v-if="isLoading" class="flex flex-col gap-2" data-testid="applied-skeleton">
      <div v-for="index in SKELETON_COUNT" :key="index" class="bg-muted h-14 animate-pulse rounded-lg" />
    </div>

    <div v-else-if="isError && items.length === 0" class="flex flex-col items-center gap-3 py-8 text-center">
      <p class="text-muted-foreground text-sm">{{ $t('settings.ai.chat.applied.loadError') }}</p>
      <Button variant="outline" data-testid="retry" @click="refetch()">
        <RotateCwIcon class="size-4" aria-hidden="true" />
        {{ $t('common.actions.retry') }}
      </Button>
    </div>

    <div
      v-else-if="items.length === 0"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center"
    >
      <CircleCheckIcon class="text-muted-foreground size-8" aria-hidden="true" />
      <p class="font-medium">{{ $t('settings.ai.chat.applied.emptyTitle') }}</p>
      <p class="text-muted-foreground max-w-md text-sm">{{ $t('settings.ai.chat.applied.emptyDescription') }}</p>
    </div>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="item in items"
        :key="item.card.id"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border p-3"
        data-testid="applied-change"
      >
        <div class="flex min-w-0 flex-col">
          <span class="text-sm font-medium wrap-anywhere">{{ titleText({ title: item.card.title }) }}</span>
          <span class="text-muted-foreground text-xs">
            {{ $t('settings.ai.chat.applied.appliedAt', { date: appliedAt({ iso: item.card.result?.appliedAt }) }) }}
          </span>
        </div>
        <RouterLink
          :to="{ name: ROUTES_NAMES.chatThread, params: { threadId: item.threadId } }"
          class="text-primary-text max-w-full truncate text-xs underline underline-offset-2"
          :title="$t('settings.ai.chat.applied.openThread')"
        >
          {{ item.threadTitle || $t('settings.ai.chat.applied.openThread') }}
        </RouterLink>
      </li>
    </ul>

    <Button
      v-if="hasNextPage"
      variant="ghost"
      class="self-center"
      data-testid="load-more"
      :disabled="isFetchingNextPage"
      @click="fetchNextPage()"
    >
      <Loader2Icon v-if="isFetchingNextPage" class="size-4 animate-spin" aria-hidden="true" />
      {{ $t('settings.ai.chat.applied.loadMore') }}
    </Button>
  </div>
</template>
