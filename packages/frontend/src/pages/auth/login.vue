<template>
  <div class="flex h-dvh items-center justify-center px-6">
    <Card class="w-full max-w-112.5" as="form" @submit.prevent="submit()">
      <card-header>
        <h1 class="text-center text-2xl font-semibold tracking-tight">{{ $t('auth.login.title') }}</h1>
      </card-header>
      <card-content class="grid gap-5">
        <div class="grid gap-3">
          <OAuthButton
            :provider="OAUTH_PROVIDER.google"
            mode="signin"
            :is-loading="isOAuthLoading"
            @click="handleOAuthLogin({ provider: OAUTH_PROVIDER.google })"
          >
            <template #icon>
              <GoogleIcon />
            </template>
          </OAuthButton>
          <OAuthButton
            :provider="OAUTH_PROVIDER.github"
            mode="signin"
            :is-loading="isOAuthLoading"
            @click="handleOAuthLogin({ provider: OAUTH_PROVIDER.github })"
          >
            <template #icon>
              <GithubIcon />
            </template>
          </OAuthButton>
          <PasskeyButton mode="signin" :is-loading="isPasskeyLoading" @click="handlePasskeyLogin" />
        </div>

        <AuthDivider :text="$t('auth.login.divider')" />

        <Callout v-if="showDemoExpiredNotice" variant="info">
          {{ $t('demo.sessionExpiredNotice') }}
        </Callout>

        <form-wrapper :error="formError" class="grid gap-5">
          <input-field
            v-model="form.email"
            name="email"
            :label="$t('common.labels.email')"
            type="email"
            :placeholder="$t('common.placeholders.email')"
            :disabled="isFormLoading"
            :error-message="getFieldErrorMessage('form.email')"
          />
          <input-field
            v-model="form.password"
            :label="$t('common.labels.password')"
            :placeholder="$t('common.placeholders.password')"
            type="password"
            :disabled="isFormLoading"
            :error-message="getFieldErrorMessage('form.password')"
          />
        </form-wrapper>

        <div class="flex justify-center">
          <Button type="submit" :disabled="isFormLoading" class="w-full">
            {{ isFormLoading ? $t('common.actions.loading') : $t('auth.login.submitButton') }}
          </Button>
        </div>
      </card-content>
      <card-footer class="text-center text-sm">
        {{ $t('auth.login.noAccount') }}

        <ResponsiveTooltip v-if="!signupsOpen" :content="$t('auth.login.signupsDisabledTooltip')">
          <span tabindex="0">
            <Button variant="link" disabled> {{ $t('common.actions.signUp') }} </Button>
          </span>
        </ResponsiveTooltip>
        <router-link v-else :to="{ name: ROUTES_NAMES.signUp }">
          <Button as="span" variant="link"> {{ $t('common.actions.signUp') }} </Button>
        </router-link>
      </card-footer>
    </Card>
  </div>
</template>

<script lang="ts" setup>
import { getSignupsOpen } from '@/api/auth';
import { getOAuthAuthorizeUrl } from '@/api/mcp';
import { DEMO_SESSION_EXPIRED_REASON } from '@/common/const';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import {
  AuthDivider,
  GithubIcon,
  GoogleIcon,
  OAUTH_PROVIDER_NAMES,
  OAuthButton,
  PasskeyButton,
} from '@/components/auth';
import InputField from '@/components/fields/input-field.vue';
import FormWrapper from '@/components/fields/form-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/lib/ui/card';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import { OAuthProviderNotConfiguredError } from '@/js/errors';
import { email, minLength, required } from '@/js/helpers/validators';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore } from '@/stores';
import { OAUTH_PROVIDER } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { Ref, computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const { login, loginWithOAuth, loginWithPasskey } = authStore;
const { addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

// Map better-auth error codes to user-friendly messages
const BETTER_AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: t('auth.login.errors.incorrectEmailOrPassword'),
  INVALID_PASSWORD: t('auth.login.errors.incorrectPassword'),
  USER_NOT_FOUND: t('auth.login.errors.userNotFound'),
  EMAIL_NOT_VERIFIED: t('auth.login.errors.emailNotVerified'),
};

const form = ref({
  email: '',
  password: '',
});
const isFormLoading = ref(false);
const formError: Ref<string | null> = ref(null);

const isOAuthLoading = ref(false);
const isPasskeyLoading = ref(false);

// Optimistic default (open) so the link doesn't flash disabled while loading.
const { data: signupsStatus } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.signupsOpen,
  queryFn: getSignupsOpen,
});
const signupsOpen = computed(() => signupsStatus.value?.signupsOpen ?? true);

// Check for OAuth error from callback redirect
const oauthError = route.query.oauth_error as string | undefined;
if (oauthError) {
  formError.value = oauthError;
  // Clean up the URL without triggering a navigation
  router.replace({ name: ROUTES_NAMES.signIn });
}

// Demo auto-logout redirects here with this reason, so the user sees why sign-in replaced the app.
const showDemoExpiredNotice = ref(route.query.reason === DEMO_SESSION_EXPIRED_REASON);
if (showDemoExpiredNotice.value) {
  router.replace({ name: ROUTES_NAMES.signIn });
}

const { isFormValid, getFieldErrorMessage } = useFormValidation(
  { form },
  {
    form: {
      email: { required, email },
      password: {
        required,
        passwordMinLength: minLength(6),
      },
    },
  },
  undefined,
  {
    customValidationMessages: {
      passwordMinLength: t('validation.minLength', { length: 6 }),
      email: t('validation.emailInvalid'),
    },
  },
);

watch(form.value, () => {
  formError.value = null;
});

const navigateAfterLogin = () => {
  // If this login was triggered by an OAuth authorization flow, redirect back
  // to the authorize endpoint so better-auth can continue with consent.
  if (route.query.response_type && route.query.client_id) {
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(route.query)) {
      if (value) queryParams[key] = String(value);
    }
    window.location.href = getOAuthAuthorizeUrl({ queryParams });
    return;
  }

  const redirectPath = route.query.redirect?.toString() || ROUTES_NAMES.home;

  if (redirectPath.startsWith('/')) {
    router.push(redirectPath);
  } else {
    router.push({ name: ROUTES_NAMES.home });
  }
};

const submit = async () => {
  if (!isFormValid()) return;

  const { email: userEmail, password } = form.value;

  try {
    isFormLoading.value = true;
    await login({ email: userEmail, password });
    navigateAfterLogin();
  } catch (e) {
    const error = e as Error;

    // Check for better-auth error codes
    for (const [code, message] of Object.entries(BETTER_AUTH_ERROR_MESSAGES)) {
      if (error.message?.includes(code)) {
        formError.value = message;
        return;
      }
    }

    formError.value = error.message || t('auth.login.errors.genericErrorRetry');
  } finally {
    isFormLoading.value = false;
  }
};

const handleOAuthLogin = async ({ provider }: { provider: OAUTH_PROVIDER }) => {
  try {
    isOAuthLoading.value = true;
    await loginWithOAuth({ provider, from: 'signin' });
  } catch (error) {
    addErrorNotification(
      error instanceof OAuthProviderNotConfiguredError
        ? t('auth.login.errors.oauthNotConfigured', { provider: OAUTH_PROVIDER_NAMES[provider] })
        : t('auth.login.errors.oauthFailed', { provider }),
    );
  } finally {
    isOAuthLoading.value = false;
  }
};

const handlePasskeyLogin = async () => {
  try {
    isPasskeyLoading.value = true;
    await loginWithPasskey();
    navigateAfterLogin();
  } catch {
    addErrorNotification(t('auth.login.errors.passkeyFailed'));
  } finally {
    isPasskeyLoading.value = false;
  }
};
</script>
