import { connectPlaid, createPlaidLinkToken } from '@/api/plaid';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserStore } from '@/stores/user';
import { useQueryClient } from '@tanstack/vue-query';
import { nextTick, onScopeDispose, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { openPlaidLink } from './utils/plaid-link';

const RESUME_KEY = 'pending-plaid-link';
const MAX_RESUME_AGE_MS = 30 * 60_000;

interface LinkSession {
  linkToken: string;
}

const rememberSession = ({ session, userId }: { session: LinkSession; userId: number }) => {
  const stored = JSON.stringify({ ...session, userId, expiresAt: Date.now() + MAX_RESUME_AGE_MS });
  try {
    window.sessionStorage.setItem(RESUME_KEY, stored);
  } catch {
    // Link can still use a popup in browsers that block session storage.
    return;
  }
  return () => {
    try {
      if (window.sessionStorage.getItem(RESUME_KEY) === stored) window.sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // Storage becoming unavailable must not interrupt a successful Link callback.
    }
  };
};

const consumeSession = ({ userId }: { userId: number }): LinkSession | undefined => {
  try {
    const stored = window.sessionStorage.getItem(RESUME_KEY);
    if (!stored) return;
    window.sessionStorage.removeItem(RESUME_KEY);
    const session = JSON.parse(stored) as (Partial<LinkSession & { userId: number; expiresAt: number }> & Record<string, unknown>) | null;
    if (
      session?.userId === userId &&
      typeof session.linkToken === 'string' &&
      session.linkToken &&
      typeof session.expiresAt === 'number' &&
      session.expiresAt > Date.now() &&
      !('connectionId' in session)
    ) {
      return { linkToken: session.linkToken };
    }
  } catch {
    // A missing, corrupt or inaccessible tab session cannot be resumed.
  }
};

type LinkRequest = { receivedRedirectUri?: string };
type LinkResult =
  | { status: 'connected'; connectionId: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' | 'failed' };

export const usePlaidLink = () => {
  const userStore = useUserStore();
  const queryClient = useQueryClient();
  const { addSuccessNotification } = useNotificationCenter();
  const { t } = useI18n();

  const phase = ref<'preparing' | 'open' | 'finishing' | null>(null);
  let active: AbortController | undefined;

  const cancel = () => {
    if (phase.value === 'finishing') return;
    active?.abort();
    active = undefined;
    phase.value = null;
  };
  onScopeDispose(() => active?.abort());

  const run = async ({ receivedRedirectUri }: LinkRequest = {}): Promise<LinkResult | undefined> => {
    if (active) return;
    const userId = userStore.user?.id;
    if (userId === undefined) return { status: 'unavailable' };

    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    phase.value = 'preparing';
    try {
      const session = receivedRedirectUri
        ? consumeSession({ userId })
        : await createPlaidLinkToken({ signal });
      signal.throwIfAborted();
      if (!session) return { status: 'unavailable' };

      let forgetSession: (() => void) | undefined;
      const outcome = await openPlaidLink({
        linkToken: session.linkToken,
        receivedRedirectUri,
        signal,
        beforeOpen: async () => {
          if (!receivedRedirectUri) forgetSession = rememberSession({ session, userId });
          phase.value = 'open';
          // Unmount the provider dialog before Link opens its own focus trap.
          await nextTick();
        },
      }).finally(() => forgetSession?.());
      if (signal.aborted || userStore.user?.id !== userId) return;
      if (outcome.status === 'cancelled') return { status: 'cancelled' };

      phase.value = 'finishing';
      if (!outcome.publicToken) return { status: 'failed' };
      const result = await connectPlaid({ publicToken: outcome.publicToken });
      await queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange] });
      if (signal.aborted || userStore.user?.id !== userId) return;
      addSuccessNotification(t('pages.integrations.notifications.connectionEstablished'));
      return { status: 'connected', connectionId: result.connectionId };
    } catch {
      if (!signal.aborted) return { status: 'failed' };
    } finally {
      if (active === controller) {
        active = undefined;
        phase.value = null;
      }
    }
  };

  return { phase, run, cancel };
};
