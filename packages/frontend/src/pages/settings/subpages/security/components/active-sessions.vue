<template>
  <div class="space-y-6">
    <div>
      <h3 class="mb-1 text-lg font-medium">{{ $t('settings.security.activeSessions.title') }}</h3>
      <p class="text-muted-foreground text-sm">{{ $t('settings.security.activeSessions.description') }}</p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Loader2Icon class="text-muted-foreground size-6 animate-spin" />
    </div>

    <!-- Load failed: never shown as an empty list -->
    <div
      v-else-if="loadFailed"
      data-testid="sessions-load-error"
      class="border-destructive/30 bg-destructive/5 flex flex-col items-center gap-3 rounded-lg border px-4 py-8 text-center"
    >
      <p class="text-destructive-text text-sm">{{ $t('settings.security.activeSessions.loadError') }}</p>
      <Button data-testid="sessions-retry" variant="outline" size="sm" @click="retryLoad">
        {{ $t('common.actions.retry') }}
      </Button>
    </div>

    <template v-else>
      <!-- Session list -->
      <div class="space-y-3">
        <div
          v-for="session in sessions"
          :key="session.id"
          data-testid="session-item"
          :class="['border-border rounded-lg border p-4', session.isCurrent && 'border-primary/50 bg-primary/5']"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-3">
              <div class="bg-muted flex size-10 items-center justify-center rounded-lg">
                <component :is="getDeviceIcon(session.userAgent)" class="text-muted-foreground size-5" />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-medium">{{ parseUserAgent(session.userAgent) }}</p>
                  <span
                    v-if="session.isCurrent"
                    class="bg-primary/10 text-primary-text rounded-full px-2 py-0.5 text-xs font-medium"
                  >
                    {{ $t('settings.security.activeSessions.currentBadge') }}
                  </span>
                </div>
                <p class="text-muted-foreground text-sm">
                  {{ session.ipAddress || $t('settings.security.activeSessions.unknownLocation') }}
                </p>
                <p class="text-muted-foreground text-xs">
                  {{
                    $t('settings.security.activeSessions.lastActive', {
                      date: formatDate(session.updatedAt || session.createdAt),
                    })
                  }}
                </p>
              </div>
            </div>
            <Button
              v-if="!session.isCurrent"
              variant="ghost-destructive"
              size="sm"
              :disabled="isRevokingSession === session.token"
              @click="handleRevokeSession(session.token)"
            >
              <Loader2Icon v-if="isRevokingSession === session.token" class="size-4 animate-spin" />
              <LogOutIcon v-else class="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- No sessions message -->
      <p v-if="sessions.length === 0" class="text-muted-foreground py-8 text-center text-sm">
        {{ $t('settings.security.activeSessions.noSessions') }}
      </p>

      <!-- Revoke all button -->
      <div v-if="otherSessions.length > 0" class="border-t pt-4">
        <Button variant="destructive" @click="handleRevokeAll">
          <LogOutIcon class="mr-2 size-4" />
          {{ $t('settings.security.activeSessions.revokeAllButton') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getAuthSessions } from '@/api/user';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { UnexpectedError, getAuthErrorMessage } from '@/js/errors';
import { authClient, getSession } from '@/lib/auth-client';
import type { AuthSessionInfo } from '@bt/shared/types';
import { Loader2Icon, LogOutIcon, MonitorIcon, SmartphoneIcon, TabletIcon } from '@lucide/vue';
import { format } from 'date-fns';
import { type Component, computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

type Session = AuthSessionInfo & { isCurrent: boolean };

const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const { t } = useI18n();

const isLoading = ref(true);
const loadFailed = ref(false);
const isRevokingSession = ref<string | null>(null);
const sessions = ref<Session[]>([]);
const currentSessionToken = ref<string | null>(null);

const otherSessions = computed(() => sessions.value.filter((s) => !s.isCurrent));

const formatDate = (dateStr: string | Date) => {
  const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('settings.security.activeSessions.timeAgo.justNow');
  if (diffMins < 60) return t('settings.security.activeSessions.timeAgo.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('settings.security.activeSessions.timeAgo.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('settings.security.activeSessions.timeAgo.daysAgo', { count: diffDays });

  return format(date, 'P');
};

const parseUserAgent = (userAgent: string | null | undefined): string => {
  if (!userAgent) return t('settings.security.activeSessions.deviceTypes.unknownDevice');

  // Simple parsing for common browsers
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    const match = userAgent.match(/Chrome\/(\d+)/);
    return `Chrome ${match?.[1] || ''}`;
  }
  if (userAgent.includes('Firefox')) {
    const match = userAgent.match(/Firefox\/(\d+)/);
    return `Firefox ${match?.[1] || ''}`;
  }
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(/Version\/(\d+)/);
    return `Safari ${match?.[1] || ''}`;
  }
  if (userAgent.includes('Edg')) {
    const match = userAgent.match(/Edg\/(\d+)/);
    return `Edge ${match?.[1] || ''}`;
  }

  return t('settings.security.activeSessions.deviceTypes.unknownBrowser');
};

const getDeviceIcon = (userAgent: string | null | undefined): Component => {
  if (!userAgent) return MonitorIcon;

  if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone')) {
    return SmartphoneIcon;
  }
  if (userAgent.includes('iPad') || userAgent.includes('Tablet')) {
    return TabletIcon;
  }

  return MonitorIcon;
};

const loadSessions = async () => {
  try {
    // Get current session to identify it
    const currentSession = await getSession();
    if (currentSession.error) throw new UnexpectedError(currentSession.error.message, currentSession.error);
    if (currentSession.data?.session) {
      currentSessionToken.value = currentSession.data.session.token;
    }

    const result = await getAuthSessions();
    sessions.value = result
      .map((s) => ({ ...s, isCurrent: s.token === currentSessionToken.value }))
      // Current session first
      .sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : 0));
    loadFailed.value = false;
  } catch (e) {
    console.error('Failed to load sessions:', e);
    loadFailed.value = true;
  }
};

const retryLoad = async () => {
  isLoading.value = true;
  await loadSessions();
  isLoading.value = false;
};

const handleRevokeSession = async (token: string) => {
  try {
    isRevokingSession.value = token;
    const { error } = await authClient.revokeSession({ token });
    if (error) throw new UnexpectedError(error.message, error);
    addSuccessNotification(t('settings.security.activeSessions.notifications.revokeSuccess'));
    await loadSessions();
  } catch (error) {
    addErrorNotification(
      await getAuthErrorMessage({ error, fallbackKey: 'settings.security.activeSessions.notifications.revokeFailed' }),
    );
  } finally {
    isRevokingSession.value = null;
  }
};

const handleRevokeAll = async () => {
  try {
    const { error } = await authClient.revokeOtherSessions();
    if (error) throw new UnexpectedError(error.message, error);
    addSuccessNotification(t('settings.security.activeSessions.notifications.revokeAllSuccess'));
    await loadSessions();
  } catch (error) {
    addErrorNotification(
      await getAuthErrorMessage({
        error,
        fallbackKey: 'settings.security.activeSessions.notifications.revokeAllFailed',
      }),
    );
  }
};

onMounted(retryLoad);
</script>
