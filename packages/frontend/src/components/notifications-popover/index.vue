<script setup lang="ts">
import type { NotificationStruct } from '@/api/notifications';
import Button from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import {
  useDismissNotification,
  useMarkAllNotificationsAsRead,
  useNotifications,
  useUnreadNotificationsCount,
} from '@/composable/data-queries/notifications';
import { isNotificationsPopoverOpen as isOpen } from '@/composable/global-state/notifications-popover';
import { useOpenNotification } from '@/composable/use-open-notification';
import { BellIcon, BellOffIcon, Loader2Icon } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

import NotificationItem from './notification-item.vue';

withDefaults(defineProps<{ sidebar?: boolean }>(), { sidebar: false });

const { t } = useI18n();
const { openNotification } = useOpenNotification();

const { data: notifications, isLoading } = useNotifications();
const { data: unreadCount } = useUnreadNotificationsCount();

const markAllAsReadMutation = useMarkAllNotificationsAsRead();
const dismissMutation = useDismissNotification();

const handleNotificationClick = (notification: NotificationStruct) => {
  if (openNotification({ notification })) {
    isOpen.value = false;
  }
};

const handleMarkAllAsRead = () => {
  markAllAsReadMutation.mutate();
};

const handleDismiss = (id: string) => {
  dismissMutation.mutate({ id });
};
</script>

<template>
  <Popover.Popover v-model:open="isOpen">
    <Popover.PopoverTrigger as-child>
      <!-- Sidebar mode: full-width button with label -->
      <template v-if="sidebar">
        <button
          class="hover:bg-accent hover:text-accent-foreground text-muted-foreground relative inline-flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors"
        >
          <BellIcon class="size-4 shrink-0" />
          <span>{{ t('notifications.title') }}</span>
          <span
            v-if="unreadCount && unreadCount > 0"
            class="bg-primary ml-auto flex size-5 items-center justify-center rounded-full text-xs text-white"
          >
            {{ unreadCount > 9 ? '9+' : unreadCount }}
          </span>
        </button>
      </template>
      <!-- Header mode: icon-only button -->
      <template v-else>
        <Button variant="secondary" size="icon" class="relative">
          <BellIcon class="size-5" />
          <span
            v-if="unreadCount && unreadCount > 0"
            class="bg-primary absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full text-xs text-white"
          >
            {{ unreadCount > 9 ? '9+' : unreadCount }}
          </span>
        </Button>
      </template>
    </Popover.PopoverTrigger>
    <Popover.PopoverContent class="w-90 p-0" :align="sidebar ? 'start' : 'end'" :side="sidebar ? 'top' : 'bottom'">
      <div class="border-border flex items-center justify-between border-b px-4 py-3">
        <h3 class="text-sm font-semibold">{{ $t('notifications.title') }}</h3>
        <Button
          v-if="unreadCount && unreadCount > 0"
          variant="ghost"
          size="sm"
          class="h-auto px-2 py-1 text-xs"
          :disabled="markAllAsReadMutation.isPending.value"
          @click="handleMarkAllAsRead"
        >
          {{ $t('notifications.markAllAsRead') }}
        </Button>
      </div>

      <div v-if="isLoading" class="flex items-center justify-center py-8">
        <Loader2Icon class="text-muted-foreground size-6 animate-spin" />
      </div>

      <div v-else-if="!notifications?.length" class="py-8 text-center">
        <BellOffIcon class="text-muted-foreground mx-auto mb-2 size-10 opacity-50" />
        <p class="text-muted-foreground text-sm">{{ $t('notifications.empty') }}</p>
      </div>

      <div v-else class="max-h-87.5 overflow-auto">
        <div class="divide-border divide-y">
          <NotificationItem
            v-for="notification in notifications"
            :key="notification.id"
            :notification="notification"
            @click="handleNotificationClick"
            @dismiss="handleDismiss"
          />
        </div>
      </div>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>
