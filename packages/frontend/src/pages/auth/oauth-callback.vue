<template>
  <div class="flex h-dvh items-center justify-center">
    <div class="text-center">
      <div v-if="isLoading" class="flex flex-col items-center gap-4">
        <div class="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
        <p class="text-muted-foreground">{{ t('auth.oauthCallback.completingSignIn') }}</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { consumePendingLoginMethod, setLastLoginMethod } from '@/lib/last-login-method';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore } from '@/stores';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const isLoading = ref(true);

/**
 * Maps OAuth error codes to user-friendly messages.
 */
type OAuthAction = 'signIn' | 'signUp' | 'link';

const ACTION_ERROR_KEYS: Record<OAuthAction, Record<string, string>> = {
  signIn: {
    access_denied: 'auth.oauthCallback.errors.accessDenied.signIn',
    user_already_exists: 'auth.oauthCallback.errors.userAlreadyExists.signIn',
    account_not_linked: 'auth.oauthCallback.errors.accountNotLinked.signIn',
  },
  signUp: {
    access_denied: 'auth.oauthCallback.errors.accessDenied.signUp',
    user_already_exists: 'auth.oauthCallback.errors.userAlreadyExists.signUp',
    account_not_linked: 'auth.oauthCallback.errors.accountNotLinked.signUp',
  },
  link: {
    access_denied: 'auth.oauthCallback.errors.accessDenied.link',
    user_already_exists: 'auth.oauthCallback.errors.userAlreadyExists.link',
    account_not_linked: 'auth.oauthCallback.errors.accountNotLinked.link',
    unable_to_link_account: 'auth.oauthCallback.errors.unableToLinkAccount',
    email_does_not_match: 'auth.oauthCallback.errors.emailDoesNotMatch',
  },
};

const GENERIC_ERROR_KEYS: Record<OAuthAction, string> = {
  signIn: 'auth.oauthCallback.errors.genericError.signIn',
  signUp: 'auth.oauthCallback.errors.genericError.signUp',
  link: 'auth.oauthCallback.errors.genericError.link',
};

const SHARED_ERROR_KEYS: Record<string, string> = {
  unauthorized_client: 'auth.oauthCallback.errors.unauthorizedClient',
  temporarily_unavailable: 'auth.oauthCallback.errors.temporarilyUnavailable',
  email_not_verified: 'auth.oauthCallback.errors.emailNotVerified',
};

const getErrorMessage = ({ error, action }: { error: string; action: OAuthAction }): string =>
  t(ACTION_ERROR_KEYS[action][error] ?? SHARED_ERROR_KEYS[error] ?? GENERIC_ERROR_KEYS[action]);

/**
 * Gets the origin page from sessionStorage and cleans it up.
 */
const getOAuthOrigin = (): 'signin' | 'signup' => {
  const from = sessionStorage.getItem('oauth_from');
  sessionStorage.removeItem('oauth_from');
  return from === 'signup' ? 'signup' : 'signin';
};

/**
 * Gets the return URL for account linking flows (e.g., connecting Google from settings).
 */
const getReturnUrl = (): string | null => {
  const returnUrl = sessionStorage.getItem('oauth_return_url');
  sessionStorage.removeItem('oauth_return_url');
  return returnUrl;
};

/**
 * Determines which page to redirect to based on the origin.
 */
const getRedirectRoute = (from: 'signin' | 'signup'): string => {
  return from === 'signup' ? ROUTES_NAMES.signUp : ROUTES_NAMES.signIn;
};

onMounted(async () => {
  const error = route.query.error as string | undefined;
  const from = getOAuthOrigin();
  const returnUrl = getReturnUrl();
  const pendingLoginMethod = consumePendingLoginMethod();
  const action: OAuthAction = returnUrl ? 'link' : from === 'signup' ? 'signUp' : 'signIn';

  // If there's an OAuth error, redirect back to the originating page with error message
  if (error) {
    const errorMessage = getErrorMessage({ error, action });

    // For account linking flows, redirect back to the return URL with error
    if (returnUrl) {
      router.replace({ path: returnUrl, query: { oauth_error: errorMessage } });
      return;
    }

    router.replace({
      name: getRedirectRoute(from),
      query: { oauth_error: errorMessage },
    });
    return;
  }

  // No error - try to validate session (OAuth succeeded)
  try {
    const isValid = await authStore.validateSession();

    if (isValid) {
      if (pendingLoginMethod) setLastLoginMethod({ method: pendingLoginMethod });
      // If we have a return URL (account linking flow), go back there
      if (returnUrl) {
        router.replace({ path: returnUrl });
        return;
      }
      // Successfully authenticated, go to dashboard
      router.replace({ name: ROUTES_NAMES.home });
    } else {
      // Session not valid, redirect to sign-in
      router.replace({
        name: ROUTES_NAMES.signIn,
        query: { oauth_error: t(GENERIC_ERROR_KEYS[action]) },
      });
    }
  } catch {
    router.replace({
      name: ROUTES_NAMES.signIn,
      query: { oauth_error: t(GENERIC_ERROR_KEYS[action]) },
    });
  }
});
</script>
