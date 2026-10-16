import { cancelCliAuthSession, getCliAuthSession, startCliAuthSession, submitCliAuthCode } from '@/api/ai-settings';
import { extractApiErrorMessage, isNotFoundError } from '@/js/errors';
import type { AICliProvider, CliAuthSessionInfo } from '@bt/shared/types';
import { type MaybeRefOrGetter, computed, onScopeDispose, readonly, ref, toValue, watch } from 'vue';

type CliSignInState = 'idle' | 'starting' | 'awaiting-user' | 'verifying' | 'succeeded' | 'failed' | 'expired';

const POLL_INTERVAL_MS = 2000;
/** A poll that keeps failing means the backend is unreachable; the sign-in can't be followed any more. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

const IN_PROGRESS_STATES: ReadonlySet<CliSignInState> = new Set(['starting', 'awaiting-user', 'verifying']);

/** The URL when it is an https one, else null; the login page is never opened over another scheme. */
const toHttpsUrl = ({ url }: { url: string | undefined }): string | null => {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/**
 * Drives one subscription sign-in (Claude Code or Codex) against the backend's auth-session endpoints:
 * `idle → starting → awaiting-user → verifying → succeeded | failed | expired`.
 *
 * `start()` must run straight from a click handler. It opens the login tab synchronously, because
 * browsers block a tab opened after the awaited request, then points it at the login URL once the
 * backend returns it. A blocked popup is not an error: the UI always offers `authUrl` as a link.
 *
 * The session id is only useful once `state` is `succeeded`; pass it as `cliAuthSessionId` on save.
 */
export const useCliSignIn = ({ provider }: { provider: MaybeRefOrGetter<AICliProvider> }) => {
  const state = ref<CliSignInState>('idle');
  const session = ref<CliAuthSessionInfo | null>(null);
  const error = ref<string | null>(null);

  // Bumped on cancel/reset/dispose so a response that lands afterwards is dropped.
  let generation = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutivePollFailures = 0;
  let pendingTab: Window | null = null;

  const stopPolling = () => {
    if (pollTimer === null) return;
    clearTimeout(pollTimer);
    pollTimer = null;
  };

  const closePendingTab = () => {
    try {
      pendingTab?.close();
    } catch {
      // A tab the browser already discarded has nothing left to close.
    }
    pendingTab = null;
  };

  const openPendingTab = () => {
    try {
      pendingTab = window.open('about:blank', '_blank');
      // The tab ends up on the vendor's site, which must not get a handle back to this page.
      if (pendingTab) pendingTab.opener = null;
    } catch {
      pendingTab = null;
    }
  };

  const navigatePendingTab = ({ url }: { url: string }) => {
    if (!pendingTab) return;
    try {
      pendingTab.location.href = url;
    } catch {
      pendingTab.close();
    }
    pendingTab = null;
  };

  const discardOnServer = ({ id }: { id: string }) => {
    cancelCliAuthSession({ id }).catch(() => {
      // Best effort: an unreachable or already gone session expires on its own.
    });
  };

  const schedulePoll = () => {
    stopPolling();
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  const applySession = ({ info }: { info: CliAuthSessionInfo }) => {
    session.value = info;
    error.value = info.error ?? null;
    state.value = info.status;

    const authUrl = toHttpsUrl({ url: info.authUrl });
    if (authUrl) navigatePendingTab({ url: authUrl });

    if (IN_PROGRESS_STATES.has(info.status)) {
      schedulePoll();
      return;
    }

    stopPolling();
    closePendingTab();
  };

  async function poll() {
    pollTimer = null;
    const id = session.value?.id;
    const startedIn = generation;
    if (!id) return;

    try {
      const info = await getCliAuthSession({ id });
      if (startedIn !== generation) return;
      consecutivePollFailures = 0;
      applySession({ info });
    } catch (e) {
      if (startedIn !== generation) return;

      if (isNotFoundError(e)) {
        state.value = 'expired';
        closePendingTab();
        return;
      }

      consecutivePollFailures += 1;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        state.value = 'failed';
        error.value = extractApiErrorMessage(e) ?? null;
        closePendingTab();
        return;
      }
      schedulePoll();
    }
  }

  /** Forgets the sign-in locally; the server-side session is dropped separately. */
  const clearLocal = () => {
    generation += 1;
    stopPolling();
    closePendingTab();
    consecutivePollFailures = 0;
    session.value = null;
    error.value = null;
    state.value = 'idle';
  };

  const start = async () => {
    if (IN_PROGRESS_STATES.has(state.value)) return;

    const previous = session.value;
    if (previous && state.value === 'succeeded') discardOnServer({ id: previous.id });
    clearLocal();

    // Synchronously, before any await: this is the only point a click still counts as user activation.
    openPendingTab();
    state.value = 'starting';
    const startedIn = generation;

    try {
      const info = await startCliAuthSession({ provider: toValue(provider) });

      if (startedIn !== generation) {
        discardOnServer({ id: info.id });
        return;
      }
      applySession({ info });
    } catch (e) {
      if (startedIn !== generation) return;
      state.value = 'failed';
      error.value = extractApiErrorMessage(e) ?? null;
      closePendingTab();
    }
  };

  /** Claude only: hands the code the login page showed to the waiting CLI. */
  const submitCode = async ({ code }: { code: string }) => {
    const id = session.value?.id;
    if (!id || state.value !== 'awaiting-user') return;

    const startedIn = generation;
    stopPolling();
    state.value = 'verifying';
    error.value = null;

    try {
      const info = await submitCliAuthCode({ id, code });
      if (startedIn !== generation) return;
      applySession({ info });
    } catch (e) {
      if (startedIn !== generation) return;

      if (isNotFoundError(e)) {
        state.value = 'expired';
        return;
      }

      // The session is still waiting for a code, so the user can correct it and submit again.
      state.value = 'awaiting-user';
      error.value = extractApiErrorMessage(e) ?? null;
      schedulePoll();
    }
  };

  /** Abandons a sign-in that is still running; any other state is left as it is. */
  const cancel = () => {
    if (!IN_PROGRESS_STATES.has(state.value)) return;
    const id = session.value?.id;
    clearLocal();
    if (id) discardOnServer({ id });
  };

  /** Back to `idle` from any state, dropping a finished-but-unsaved sign-in as well. */
  const reset = () => {
    const id = session.value?.id;
    const isServerSessionAlive = IN_PROGRESS_STATES.has(state.value) || state.value === 'succeeded';
    clearLocal();
    if (id && isServerSessionAlive) discardOnServer({ id });
  };

  // A different provider's sign-in must not leak into this one.
  watch(
    () => toValue(provider),
    () => reset(),
  );

  // A succeeded session is left alone: the save that follows consumes it, and it expires on its own otherwise.
  onScopeDispose(() => {
    const id = session.value?.id;
    const isInProgress = IN_PROGRESS_STATES.has(state.value);
    clearLocal();
    if (id && isInProgress) discardOnServer({ id });
  });

  return {
    state: readonly(state),
    session: readonly(session),
    sessionId: computed(() => session.value?.id ?? null),
    /** Only an https URL is ever exposed, whatever the backend sent. */
    authUrl: computed(() => toHttpsUrl({ url: session.value?.authUrl })),
    userCode: computed(() => session.value?.userCode ?? null),
    /** The server's message for a failed sign-in or a rejected code; null when there is none. */
    error: readonly(error),
    isInProgress: computed(() => IN_PROGRESS_STATES.has(state.value)),
    start,
    submitCode,
    cancel,
    reset,
  };
};
