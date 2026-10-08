import { analyticsPlan } from '@/common/const/billing';
import type { DemoEndReason } from '@/common/const/demo';
import { getDeviceName } from '@/common/utils/device-name';
import { dismissPersistentNotifications } from '@/components/notification-center';
import { isMobileSheetOpen } from '@/composable/global-state/mobile-sheet';
import { OAuthProviderNotConfiguredError, UnexpectedError } from '@/js/errors';
import { authClient, getSession, signIn, signOut, signUp } from '@/lib/auth-client';
import {
  consumeDemoOriginProperties,
  hasSignedInOnDevice,
  markDemoOrigin,
  markSignedInOnDevice,
} from '@/lib/demo-origin';
import { identifyUser, resetUser, startSessionRecording, trackAnalyticsEvent } from '@/lib/posthog';
import { collectPersistedQueryGarbage, resetQueryCaches } from '@/lib/query-persister';
import { captureException, clearSentryUser, setSentryUser } from '@/lib/sentry';
import { useCategoriesStore, useCurrenciesStore, useUserStore } from '@/stores';
import { OAUTH_PROVIDER, USER_ROLES, UserInfoResponse } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { resetAllDefinedStores } from './setup';

/**
 * Identify user for analytics and error tracking
 */
function identifyUserForTracking(user: UserInfoResponse) {
  const isDemo = user.role === USER_ROLES.demo;

  // Demo accounts hold generated data, so recording exposes no real finances and keeps quota small.
  if (isDemo) {
    startSessionRecording();
  }

  // Read the device flag before setting it, otherwise this sign-in gates itself out.
  const demoOriginProperties = isDemo
    ? {}
    : consumeDemoOriginProperties({ isFirstSignInOnDevice: !hasSignedInOnDevice() });

  if (!isDemo) {
    markSignedInOnDevice();
  }

  // PostHog analytics
  identifyUser({
    userId: user.id,
    email: user.email ?? undefined,
    username: user.username,
    properties: {
      is_demo: isDemo,
      user_role: user.role,
      plan: isDemo ? 'demo' : user.entitlements && analyticsPlan({ entitlements: user.entitlements }),
      granted_plan: user.entitlements?.plan ?? null,
      ...demoOriginProperties,
    },
  });

  // Sentry error tracking
  setSentryUser({
    userId: user.id,
    email: user.email ?? undefined,
    username: user.username,
  });
}

const HAS_EVER_LOGGED_IN_KEY = 'has-ever-logged-in';
// Identity of the user whose queries are currently persisted on this device.
// Compared on every auth entry so a session swap without an explicit logout
// (expiry, logging into a different account) can't restore the prior user's data.
const PERSISTED_QUERIES_USER_KEY = 'persisted-queries-user-id';

export const useAuthStore = defineStore('auth', () => {
  const userStore = useUserStore();
  const categoriesStore = useCategoriesStore();
  const currenciesStore = useCurrenciesStore();
  const queryClient = useQueryClient();

  const isLoggedIn = ref(false);
  const isSessionChecked = ref(false);
  const isReturningUser = Boolean(localStorage.getItem(HAS_EVER_LOGGED_IN_KEY));

  /**
   * Drop persisted (IndexedDB) and in-memory query caches when the authenticated
   * user differs from the one whose data was last persisted on this device. Runs
   * before any persisted query mounts so a fresh account never restores another's
   * cached lists. No-op on first login and when the same user returns.
   */
  const reconcilePersistedQueriesForUser = async () => {
    const currentUserId = userStore.user?.id;
    if (currentUserId == null) return;

    const currentUserIdStr = String(currentUserId);
    const lastSeenUserId = localStorage.getItem(PERSISTED_QUERIES_USER_KEY);

    if (lastSeenUserId !== null && lastSeenUserId !== currentUserIdStr) {
      // Keeping the previous user's stamp makes the next load retry a failed wipe.
      const isWiped = await resetQueryCaches(queryClient);
      if (!isWiped) return;
    }

    localStorage.setItem(PERSISTED_QUERIES_USER_KEY, currentUserIdStr);
  };

  /**
   * Loads initial data after authentication (currencies, categories)
   */
  const loadPostAuthData = async () => {
    await reconcilePersistedQueriesForUser();
    // Sweep abandoned persisted-query rows (see `collectPersistedQueryGarbage`);
    // not awaited – nothing below depends on it.
    void collectPersistedQueryGarbage();
    await Promise.all([currenciesStore.loadBaseCurrency(), categoriesStore.loadCategories()]);
  };

  /**
   * Sets the logged in state and loads necessary data
   */
  const setLoggedIn = async () => {
    await loadPostAuthData();
    isLoggedIn.value = true;
  };

  /**
   * Login with email and password
   */
  const login = async ({ email, password }: { email: string; password: string }) => {
    const result = await signIn.email({
      email,
      password,
    });

    if (result.error) {
      throw new UnexpectedError(result.error.message || 'Login failed');
    }

    await userStore.loadUser();
    await loadPostAuthData();

    // Identify user for analytics and error tracking
    if (userStore.user) {
      identifyUserForTracking(userStore.user);
    }

    isLoggedIn.value = true;
    localStorage.setItem(HAS_EVER_LOGGED_IN_KEY, 'true');
  };

  /**
   * Login with OAuth provider
   * @param provider - The OAuth provider
   * @param from - The page to redirect back to on error ('signin' or 'signup')
   */
  const loginWithOAuth = async ({
    provider,
    from = 'signin',
  }: {
    provider: OAUTH_PROVIDER;
    from?: 'signin' | 'signup';
  }) => {
    sessionStorage.setItem('oauth_from', from);

    const result = await signIn.social({
      provider,
      callbackURL: `${window.location.origin}/auth/callback`,
    });

    if (result.error) {
      // better-auth removes providers whose credentials env vars aren't set from
      // its enabled set, so a sign-in attempt for one of them answers 404 /
      // PROVIDER_NOT_FOUND. Surface that as a distinct error so the UI can tell
      // the user the provider isn't configured rather than "please try again".
      const { status, code } = result.error as { status?: number; code?: string };
      if (code === 'PROVIDER_NOT_FOUND' || status === 404) {
        throw new OAuthProviderNotConfiguredError(provider);
      }
      throw new UnexpectedError(result.error.message || `${provider} login failed`);
    }
  };

  /**
   * Login with passkey (WebAuthn)
   */
  const loginWithPasskey = async () => {
    const result = await authClient.signIn.passkey();

    if (result.error) {
      throw new UnexpectedError(result.error.message || 'Passkey login failed');
    }

    await userStore.loadUser();
    await loadPostAuthData();

    // Identify user for analytics and error tracking
    if (userStore.user) {
      identifyUserForTracking(userStore.user);
    }

    isLoggedIn.value = true;
    localStorage.setItem(HAS_EVER_LOGGED_IN_KEY, 'true');
  };

  /**
   * Register a new passkey for the current user
   */
  const registerPasskey = async ({ name }: { name?: string } = {}) => {
    const result = await authClient.passkey.addPasskey({
      name: name || getDeviceName(),
    });

    if (result.error) {
      throw new UnexpectedError(result.error.message || 'Failed to register passkey');
    }

    return result;
  };

  /**
   * Validates the current session by checking with better-auth.
   * Sets isSessionChecked to true after validation attempt.
   */
  const validateSession = async (): Promise<boolean> => {
    try {
      const session = await getSession();

      if (!session?.data?.session) {
        isSessionChecked.value = true;
        return false;
      }

      await userStore.loadUser();
      await setLoggedIn();

      // Identify user for analytics and error tracking
      if (userStore.user) {
        identifyUserForTracking(userStore.user);
      }

      isSessionChecked.value = true;
      return true;
    } catch (error) {
      // Everything above returns a result object or is our own code; a throw here signals a
      // network failure or bug that the catch below reports as an ordinary signed-out state.
      captureException({ error, context: { scope: 'auth:validate-session' } });
      isLoggedIn.value = false;
      isSessionChecked.value = true;
      return false;
    }
  };

  /**
   * Sign up with email and password.
   * Note: Does NOT auto-login - user must verify email first (if email verification is enabled).
   * After email verification, user is auto-signed in and redirected to /auth/callback.
   */
  const signup = async ({ email, password, name }: { email: string; password: string; name?: string }) => {
    const result = await signUp.email({
      email,
      password,
      name: name || email.split('@')[0]!,
      // Callback URL after email verification - goes to auth callback which validates session
      callbackURL: `${window.location.origin}/auth/callback`,
    });

    if (result.error) {
      throw new UnexpectedError(result.error.message || 'Signup failed', result.error);
    }

    // Don't auto-login - user needs to verify email first
    // The register page will redirect to verify-email page
  };

  /** `demoEndReason` only matters for a demo account; it labels the demo funnel's terminal event. */
  const logout = async ({ demoEndReason = 'logout' }: { demoEndReason?: DemoEndReason } = {}) => {
    const wasDemo = userStore.isDemo;

    try {
      await signOut();
    } catch (error) {
      // Local state clears either way; a session the server never dropped deserves visibility.
      captureException({ error, context: { scope: 'auth:logout-signout' } });
    }

    // Fires before `resetUser` so the event still carries the demo distinct ID.
    if (wasDemo) {
      trackAnalyticsEvent({ event: 'demo_session_ended', properties: { reason: demoEndReason } });
      markDemoOrigin({ reason: demoEndReason });
    }

    // Reset analytics and error tracking user context
    resetUser();
    clearSentryUser();

    isMobileSheetOpen.value = false;
    dismissPersistentNotifications();
    // Set logged out state before resetting stores
    isLoggedIn.value = false;
    // Cancel in-flight queries, drop the in-memory cache, and wipe the on-device
    // persisted store so no financial data survives logout on a shared device.
    await resetQueryCaches(queryClient);
    resetAllDefinedStores();
  };

  watch(isLoggedIn, (newValue) => {
    // Only invalidate queries when logging IN, not when logging out
    if (newValue) {
      queryClient.invalidateQueries();
    }
  });

  return {
    isLoggedIn,
    isSessionChecked,
    isReturningUser,

    setLoggedIn,
    validateSession,
    login,
    loginWithOAuth,
    loginWithPasskey,
    registerPasskey,
    signup,
    logout,
  };
});
