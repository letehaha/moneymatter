<template>
  <div class="flex h-dvh items-center justify-center px-6">
    <Card class="w-full max-w-112.5" as="form" @submit.prevent="submit">
      <CardHeader>
        <h1 class="text-center text-2xl font-semibold tracking-tight">{{ $t('auth.signup.title') }}</h1>
      </CardHeader>
      <CardContent class="grid gap-5">
        <!-- OAuth buttons -->
        <div class="grid gap-3">
          <OAuthButton
            :provider="OAUTH_PROVIDER.google"
            mode="signup"
            :is-loading="isOAuthLoading"
            @click="handleOAuthSignup({ provider: OAUTH_PROVIDER.google })"
          >
            <template #icon>
              <GoogleIcon />
            </template>
          </OAuthButton>
          <OAuthButton
            :provider="OAUTH_PROVIDER.github"
            mode="signup"
            :is-loading="isOAuthLoading"
            @click="handleOAuthSignup({ provider: OAUTH_PROVIDER.github })"
          >
            <template #icon>
              <GithubIcon />
            </template>
          </OAuthButton>
        </div>

        <AuthDivider :text="$t('auth.signup.divider')" />

        <!-- Email credentials form -->
        <form-wrapper :error="formError" class="grid gap-5">
          <input-field
            v-model="form.email"
            :label="$t('common.labels.email')"
            type="email"
            :placeholder="$t('common.placeholders.email')"
            :disabled="isFormLoading"
            :error-message="getFieldErrorMessage('form.email')"
          />
          <input-field
            v-model="form.name"
            :label="$t('auth.signup.labels.displayName')"
            :placeholder="$t('auth.signup.placeholders.displayName')"
            :disabled="isFormLoading"
            :error-message="getFieldErrorMessage('form.name')"
          />
          <input-field
            v-model="form.password"
            :label="$t('common.labels.password')"
            type="password"
            :placeholder="$t('common.placeholders.password')"
            :disabled="isFormLoading"
            :error-message="getFieldErrorMessage('form.password')"
          />
          <input-field
            v-model="form.verifyPassword"
            :label="$t('auth.signup.labels.verifyPassword')"
            type="password"
            :placeholder="$t('auth.signup.placeholders.verifyPassword')"
            :disabled="isFormLoading"
            :error-message="getFieldErrorMessage('form.verifyPassword')"
          />
        </form-wrapper>

        <div class="flex justify-center">
          <Button type="submit" :disabled="isFormLoading" class="w-full">
            {{ isFormLoading ? $t('common.actions.loading') : $t('auth.signup.submitButton') }}
          </Button>
        </div>
      </CardContent>

      <CardFooter class="text-center text-sm">
        {{ $t('auth.signup.alreadyHaveAccount') }}

        <router-link :to="{ name: ROUTES_NAMES.signIn }">
          <Button as="span" variant="link"> {{ $t('auth.signup.signInLink') }} </Button>
        </router-link>
      </CardFooter>
    </Card>
  </div>
</template>

<script lang="ts" setup>
import { AuthDivider, GithubIcon, GoogleIcon, OAUTH_PROVIDER_NAMES, OAuthButton } from '@/components/auth';
import InputField from '@/components/fields/input-field.vue';
import FormWrapper from '@/components/fields/form-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/lib/ui/card';
import { useFormValidation } from '@/composable';
import { ApiErrorResponseError, OAuthProviderNotConfiguredError, UnexpectedError } from '@/js/errors';
import { email, minLength, required, sameAs } from '@/js/helpers/validators';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore } from '@/stores';
import { API_ERROR_CODES, OAUTH_PROVIDER } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { Ref, computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const isOAuthLoading = ref(false);
const formError: Ref<string | null> = ref(null);
const { t } = useI18n();

// Map better-auth error codes to user-friendly messages
const BETTER_AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL: t('auth.signup.errors.invalidEmail'),
  PASSWORD_TOO_SHORT: t('auth.signup.errors.passwordTooShort'),
  PASSWORD_TOO_LONG: t('auth.signup.errors.passwordTooLong'),
  INVALID_PASSWORD: t('auth.signup.errors.invalidPassword'),
  SIGNUPS_DISABLED: t('auth.signup.errors.signupsDisabled'),
};
const form = reactive({
  email: '',
  name: '',
  password: '',
  verifyPassword: '',
});

// Check for OAuth error from callback redirect
const oauthError = route.query.oauth_error as string | undefined;
if (oauthError) {
  formError.value = oauthError;
  // Clean up the URL without triggering a navigation
  router.replace({ name: ROUTES_NAMES.signUp });
}

const { isFormValid, getFieldErrorMessage } = useFormValidation(
  { form },
  {
    form: {
      email: { required, email },
      name: { required },
      password: {
        required,
        passwordMinLength: minLength(6),
      },
      verifyPassword: {
        required,
        passwordMinLength: minLength(6),
        sameAs: sameAs(computed(() => form.password)),
      },
    },
  },
  undefined,
  {
    customValidationMessages: {
      passwordMinLength: t('validation.minLength', { length: 6 }),
      sameAs: t('validation.passwordsNoMatch'),
      email: t('validation.emailInvalid'),
    },
  },
);

const { mutate: registerUser, isPending: isFormLoading } = useMutation({
  mutationFn: ({ email: userEmail, password, name }: { email: string; password: string; name: string }) =>
    authStore.signup({ email: userEmail, password, name }),
  onSuccess: () => {
    // Store email in sessionStorage (not URL) to prevent manipulation
    sessionStorage.setItem('verify_email_address', form.email);
    router.push({ name: ROUTES_NAMES.verifyEmail });
  },
  onError: (error) => {
    // Check for our custom API errors
    if (error instanceof ApiErrorResponseError) {
      if (error.data.code === API_ERROR_CODES.userExists) {
        formError.value = t('auth.signup.errors.userExists');
        return;
      }
    }

    // Check for better-auth error codes in the message
    const betterAuthCode =
      error instanceof UnexpectedError ? (error.data as { code?: string } | undefined)?.code : undefined;
    for (const [code, message] of Object.entries(BETTER_AUTH_ERROR_MESSAGES)) {
      if (betterAuthCode === code || error.message?.includes(code)) {
        formError.value = message;
        return;
      }
    }

    // Fall back to actual error message
    formError.value = error.message || t('auth.signup.errors.genericErrorRetry');
  },
});

const submit = () => {
  if (!isFormValid()) return;

  const { email: userEmail, name, password } = form;
  registerUser({ email: userEmail, name, password });
};

const handleOAuthSignup = async ({ provider }: { provider: OAUTH_PROVIDER }) => {
  try {
    isOAuthLoading.value = true;
    await authStore.loginWithOAuth({ provider, from: 'signup' });
  } catch (error) {
    formError.value =
      error instanceof OAuthProviderNotConfiguredError
        ? t('auth.signup.errors.oauthNotConfigured', { provider: OAUTH_PROVIDER_NAMES[provider] })
        : t('auth.signup.errors.oauthFailed', { provider });
  } finally {
    isOAuthLoading.value = false;
  }
};
</script>
