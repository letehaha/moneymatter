<script setup lang="ts">
import type { NotificationStruct } from '@/api/notifications';
import { useDateLocale } from '@/composable/use-date-locale';
import {
  ChangelogNotificationPayload,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  NotificationType,
  type ShareInvitationNotificationPayload,
  type ShareInvitationSendFailedPayload,
  type ShareLifecycleNotificationPayload,
  TagReminderNotificationPayload,
} from '@bt/shared/types';
import {
  AlertTriangleIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ClockIcon,
  HandshakeIcon,
  HomeIcon,
  HourglassIcon,
  InfoIcon,
  LogOutIcon,
  MailIcon,
  MailWarningIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SparklesIcon,
  TagIcon,
  Trash2Icon,
  UserXIcon,
  WalletIcon,
  XIcon,
} from '@lucide/vue';
import { useI18n } from 'vue-i18n';

import ChangelogContent from './changelog-content.vue';
import DefaultContent from './default-content.vue';
import ShareContent from './share-content.vue';
import TagReminderContent from './tag-reminder-content.vue';

const SHARE_NOTIFICATION_TYPES: NotificationType[] = [
  NOTIFICATION_TYPES.shareInvitationReceived,
  NOTIFICATION_TYPES.shareInvitationSendFailed,
  NOTIFICATION_TYPES.shareAccepted,
  NOTIFICATION_TYPES.shareDeclined,
  NOTIFICATION_TYPES.shareRevoked,
  NOTIFICATION_TYPES.shareLeft,
  NOTIFICATION_TYPES.shareExpired,
  NOTIFICATION_TYPES.shareOwnerAccountDeleted,
  NOTIFICATION_TYPES.householdInvitationReceived,
  NOTIFICATION_TYPES.householdInvitationSendFailed,
  NOTIFICATION_TYPES.householdAccepted,
  NOTIFICATION_TYPES.householdDeclined,
  NOTIFICATION_TYPES.householdPermissionChanged,
  NOTIFICATION_TYPES.householdRevoked,
  NOTIFICATION_TYPES.householdLeft,
  NOTIFICATION_TYPES.householdExpired,
  NOTIFICATION_TYPES.householdOwnerAccountDeleted,
  NOTIFICATION_TYPES.householdMemberAccountDeleted,
];

const props = defineProps<{
  notification: NotificationStruct;
}>();

const emit = defineEmits<{
  click: [notification: NotificationStruct];
  dismiss: [id: string];
}>();

const { t } = useI18n();
const { formatDistanceToNow } = useDateLocale();

const getIcon = (type: NotificationType) => {
  switch (type) {
    case NOTIFICATION_TYPES.budgetAlert:
      return WalletIcon;
    case NOTIFICATION_TYPES.system:
      return AlertTriangleIcon;
    case NOTIFICATION_TYPES.changelog:
      return SparklesIcon;
    case NOTIFICATION_TYPES.tagReminder:
      return TagIcon;
    case NOTIFICATION_TYPES.subscriptionReminder:
      return CalendarClockIcon;
    case NOTIFICATION_TYPES.plannedConfirmed:
      return CalendarCheckIcon;
    case NOTIFICATION_TYPES.stuckPending:
      return HourglassIcon;
    case NOTIFICATION_TYPES.shareInvitationReceived:
    case NOTIFICATION_TYPES.householdInvitationReceived:
      return MailIcon;
    case NOTIFICATION_TYPES.shareInvitationSendFailed:
    case NOTIFICATION_TYPES.householdInvitationSendFailed:
      return MailWarningIcon;
    case NOTIFICATION_TYPES.shareAccepted:
      return HandshakeIcon;
    case NOTIFICATION_TYPES.householdAccepted:
      return HomeIcon;
    case NOTIFICATION_TYPES.shareDeclined:
    case NOTIFICATION_TYPES.householdDeclined:
      return UserXIcon;
    case NOTIFICATION_TYPES.householdPermissionChanged:
      return ShieldCheckIcon;
    case NOTIFICATION_TYPES.shareRevoked:
    case NOTIFICATION_TYPES.householdRevoked:
      return ShieldOffIcon;
    case NOTIFICATION_TYPES.shareLeft:
    case NOTIFICATION_TYPES.householdLeft:
      return LogOutIcon;
    case NOTIFICATION_TYPES.shareExpired:
    case NOTIFICATION_TYPES.householdExpired:
      return ClockIcon;
    case NOTIFICATION_TYPES.shareOwnerAccountDeleted:
    case NOTIFICATION_TYPES.householdOwnerAccountDeleted:
    case NOTIFICATION_TYPES.householdMemberAccountDeleted:
      return Trash2Icon;
    default:
      return InfoIcon;
  }
};

const getIconBg = (type: NotificationType) => {
  switch (type) {
    case NOTIFICATION_TYPES.budgetAlert:
      return 'bg-orange-500';
    case NOTIFICATION_TYPES.system:
      return 'bg-blue-500';
    case NOTIFICATION_TYPES.changelog:
      return 'bg-purple-500';
    case NOTIFICATION_TYPES.tagReminder:
      return 'bg-amber-500';
    case NOTIFICATION_TYPES.subscriptionReminder:
      return 'bg-cyan-500';
    case NOTIFICATION_TYPES.plannedConfirmed:
      return 'bg-teal-500';
    case NOTIFICATION_TYPES.stuckPending:
      return 'bg-yellow-500';
    case NOTIFICATION_TYPES.shareInvitationReceived:
    case NOTIFICATION_TYPES.householdInvitationReceived:
      return 'bg-violet-500';
    case NOTIFICATION_TYPES.shareInvitationSendFailed:
    case NOTIFICATION_TYPES.householdInvitationSendFailed:
      return 'bg-orange-600';
    case NOTIFICATION_TYPES.shareAccepted:
    case NOTIFICATION_TYPES.householdAccepted:
      return 'bg-emerald-500';
    case NOTIFICATION_TYPES.householdPermissionChanged:
      return 'bg-sky-500';
    case NOTIFICATION_TYPES.shareDeclined:
    case NOTIFICATION_TYPES.shareRevoked:
    case NOTIFICATION_TYPES.shareOwnerAccountDeleted:
    case NOTIFICATION_TYPES.householdDeclined:
    case NOTIFICATION_TYPES.householdRevoked:
    case NOTIFICATION_TYPES.householdOwnerAccountDeleted:
    case NOTIFICATION_TYPES.householdMemberAccountDeleted:
      return 'bg-rose-500';
    case NOTIFICATION_TYPES.shareLeft:
    case NOTIFICATION_TYPES.shareExpired:
    case NOTIFICATION_TYPES.householdLeft:
    case NOTIFICATION_TYPES.householdExpired:
      return 'bg-slate-500';
    default:
      return 'bg-gray-500';
  }
};

const isShareNotification = (type: NotificationType) => SHARE_NOTIFICATION_TYPES.includes(type);

const getTitle = (notification: NotificationStruct): string => {
  if (notification.type === NOTIFICATION_TYPES.changelog) {
    const payload = notification.payload as ChangelogNotificationPayload;
    return payload?.version
      ? t('notifications.newVersion', { version: payload.version })
      : t('notifications.newRelease');
  }
  return notification.title || '';
};

const formatRelativeTime = (date: Date | string) => {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
};

const handleClick = () => {
  emit('click', props.notification);
};

const handleDismiss = (event: Event) => {
  event.stopPropagation();
  emit('dismiss', props.notification.id);
};
</script>

<template>
  <div
    :class="[
      'group hover:bg-accent relative cursor-pointer px-4 py-3 transition-colors',
      notification.status === NOTIFICATION_STATUSES.unread && 'bg-accent/50',
    ]"
    @click="handleClick"
  >
    <div class="flex items-start gap-3">
      <div
        :class="['mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', getIconBg(notification.type)]"
      >
        <component :is="getIcon(notification.type)" class="size-4 text-white" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <p
            :class="
              notification.type === NOTIFICATION_TYPES.changelog
                ? 'text-muted-foreground line-clamp-2 text-xs'
                : [
                    'line-clamp-2 text-sm',
                    notification.status === NOTIFICATION_STATUSES.unread ? 'font-semibold' : 'font-medium',
                  ]
            "
          >
            {{ getTitle(notification) }}
          </p>
          <button
            class="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            @click="handleDismiss"
          >
            <XIcon class="size-4" />
          </button>
        </div>

        <!-- Type-specific content -->
        <ChangelogContent
          v-if="notification.type === NOTIFICATION_TYPES.changelog"
          :payload="notification.payload as ChangelogNotificationPayload"
          :unread="notification.status === NOTIFICATION_STATUSES.unread"
        />
        <TagReminderContent
          v-else-if="notification.type === NOTIFICATION_TYPES.tagReminder"
          :payload="notification.payload as TagReminderNotificationPayload"
        />
        <ShareContent
          v-else-if="isShareNotification(notification.type)"
          :type="notification.type"
          :payload="
            notification.payload as
              | ShareInvitationNotificationPayload
              | ShareInvitationSendFailedPayload
              | ShareLifecycleNotificationPayload
              | undefined
          "
        />
        <DefaultContent v-else :message="notification.message" />

        <p class="text-muted-foreground mt-1 text-xs">
          {{ formatRelativeTime(notification.createdAt) }}
        </p>
      </div>
    </div>
  </div>
</template>
