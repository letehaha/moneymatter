<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useChatContextLabel } from '@/components/chat/chat-context-label';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { ChatThreadSearchHit } from '@bt/shared/types';
import { MapPinIcon, PencilIcon, PinIcon, PinOffIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';

const props = defineProps<{
  thread: ChatThreadSearchHit;
  /** This is the thread the page shows. */
  active: boolean;
}>();

const emit = defineEmits<{
  select: [];
  rename: [title: string];
  'toggle-pin': [];
  delete: [];
}>();

const { formatDistanceToNow } = useDateLocale();
const { label: contextLabel } = useChatContextLabel();

/** Where the conversation started, kept for the whole thread; absent when it has no page. */
const startedFrom = computed(() =>
  props.thread.pageContext
    ? contextLabel({ context: props.thread.pageContext, names: props.thread.pageContextNames })
    : null,
);

const isRenaming = ref(false);
const draft = ref('');

const lastActivity = computed(() => formatDistanceToNow(new Date(props.thread.lastMessageAt), { addSuffix: true }));

const startRename = () => {
  draft.value = props.thread.title;
  isRenaming.value = true;
};

const finishRename = ({ save }: { save: boolean }) => {
  // Enter ends the edit and removes the field, which can blur it on the way out.
  if (!isRenaming.value) return;
  isRenaming.value = false;

  const title = draft.value.trim();
  if (save && title !== '' && title !== props.thread.title) emit('rename', title);
};
</script>

<template>
  <li
    :class="
      cn(
        'group/thread hover:bg-muted/60 relative flex items-center gap-1 rounded-lg pr-1 transition-colors',
        active && 'bg-primary/10 hover:bg-primary/10',
      )
    "
    data-testid="thread-item"
  >
    <div
      v-if="isRenaming"
      class="min-w-0 flex-1 p-1"
      @keydown.enter.prevent="finishRename({ save: true })"
      @keydown.esc.prevent="finishRename({ save: false })"
      @focusout="finishRename({ save: true })"
    >
      <InputField
        v-model="draft"
        autofocus
        :aria-label="$t('chat.threads.renameLabel')"
        :placeholder="$t('chat.threads.renamePlaceholder')"
      />
    </div>

    <template v-else>
      <button
        type="button"
        class="focus-visible:ring-ring flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-hidden focus-visible:ring-2"
        data-testid="thread-select"
        :aria-current="active ? 'true' : undefined"
        @click="emit('select')"
      >
        <span class="flex items-center gap-1.5">
          <PinIcon v-if="thread.pinned" class="text-muted-foreground size-3 shrink-0" aria-hidden="true" />
          <span class="truncate text-sm font-medium">{{ thread.title || $t('chat.threads.untitled') }}</span>
        </span>
        <span class="text-muted-foreground truncate text-xs">{{ thread.snippet || lastActivity }}</span>
        <span
          v-if="startedFrom"
          class="text-muted-foreground/80 flex min-w-0 items-center gap-1 text-xs"
          data-testid="thread-context"
        >
          <MapPinIcon class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate" :title="startedFrom">{{ startedFrom }}</span>
        </span>
      </button>

      <div
        class="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/thread:opacity-100 group-hover/thread:opacity-100 pointer-coarse:opacity-100"
      >
        <DesktopOnlyTooltip :content="$t('chat.threads.actions.rename')">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="thread-rename"
            :aria-label="$t('chat.threads.actions.rename')"
            @click="startRename"
          >
            <PencilIcon class="size-3.5" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip
          :content="thread.pinned ? $t('chat.threads.actions.unpin') : $t('chat.threads.actions.pin')"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="thread-pin"
            :aria-label="thread.pinned ? $t('chat.threads.actions.unpin') : $t('chat.threads.actions.pin')"
            @click="emit('toggle-pin')"
          >
            <PinOffIcon v-if="thread.pinned" class="size-3.5" aria-hidden="true" />
            <PinIcon v-else class="size-3.5" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip :content="$t('chat.threads.actions.delete')">
          <Button
            variant="ghost-destructive"
            size="icon-sm"
            data-testid="thread-delete"
            :aria-label="$t('chat.threads.actions.delete')"
            @click="emit('delete')"
          >
            <Trash2Icon class="size-3.5" aria-hidden="true" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </template>
  </li>
</template>
