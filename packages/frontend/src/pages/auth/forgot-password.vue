<template>
  <div class="flex h-dvh items-center justify-center px-6">
    <Card class="w-full max-w-112.5" as="form" @submit.prevent="submit()">
      <CardHeader class="text-center">
        <div class="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <MailIcon v-if="isSent" class="text-primary-text h-8 w-8" />
          <KeyRoundIcon v-else class="text-primary-text h-8 w-8" />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ isSent ? $t('auth.forgotPassword.sentTitle') : $t('auth.forgotPassword.title') }}
        </h1>
      </CardHeader>

      <CardContent v-if="isUnavailable" class="text-center">
        <p class="text-muted-foreground">{{ $t('auth.forgotPassword.unavailable') }}</p>
      </CardContent>

      <CardContent v-else-if="isSent" class="text-center">
        <p class="text-muted-foreground mb-6">{{ $t('auth.forgotPassword.sentDescription') }}</p>

        <div class="bg-muted/50 text-muted-foreground mb-3 rounded-lg p-4 text-sm">
          <span class="text-foreground font-semibold">{{ $t('auth.forgotPassword.nothingChangesTitle') }}</span>
          {{ $t('auth.forgotPassword.nothingChangesDescription') }}
        </div>

        <div class="bg-muted/50 text-muted-foreground rounded-lg p-4 text-sm">
          <p>{{ $t('auth.forgotPassword.didntReceive') }}</p>
          <Button
            type="button"
            variant="link"
            class="text-primary-text h-auto p-0"
            :disabled="isLoading || resendCooldown > 0"
            @click="submit()"
          >
            {{ resendButtonText }}
          </Button>
        </div>
      </CardContent>

      <CardContent v-else class="grid gap-5">
        <p class="text-muted-foreground text-center">{{ $t('auth.forgotPassword.description') }}</p>

        <input-field
          v-model="form.email"
          name="email"
          :label="$t('common.labels.email')"
          type="email"
          :placeholder="$t('common.placeholders.email')"
          :disabled="isLoading"
          :error-message="getFieldErrorMessage('form.email')"
        />

        <Button type="submit" :disabled="isLoading" class="w-full">
          {{ isLoading ? $t('common.actions.loading') : $t('auth.forgotPassword.submitButton') }}
        </Button>
      </CardContent>

      <CardFooter>
        <router-link :to="{ name: ROUTES_NAMES.signIn }" class="w-full">
          <Button as="span" variant="outline" class="w-full"> {{ $t('auth.forgotPassword.backToSignIn') }} </Button>
        </router-link>
      </CardFooter>
    </Card>
  </div>
</template>

<script lang="ts" setup>
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/lib/ui/card';
import { useNotificationCenter } from '@/components/notification-center';
import { useAuthFeatures, useFormValidation } from '@/composable';
import { email, required } from '@/js/helpers/validators';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { KeyRoundIcon, MailIcon } from '@lucide/vue';
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const RESEND_COOLDOWN_SECONDS = 60;
const RESET_PASSWORD_DISABLED_CODE = 'RESET_PASSWORD_DISABLED';
const TOO_MANY_REQUESTS_STATUS = 429;

const { t } = useI18n();
const router = useRouter();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

const { authFeatures } = useAuthFeatures();
const isResetDisabledByServer = ref(false);
const isUnavailable = computed(() => authFeatures.value?.emailEnabled === false || isResetDisabledByServer.value);

const form = ref({ email: '' });
const isLoading = ref(false);
const isSent = ref(false);
const resendCooldown = ref(0);
let cooldownInterval: ReturnType<typeof setInterval> | null = null;

const { isFormValid, getFieldErrorMessage } = useFormValidation(
  { form },
  { form: { email: { required, email } } },
  undefined,
  { customValidationMessages: { email: t('validation.emailInvalid') } },
);

onUnmounted(() => {
  if (cooldownInterval) clearInterval(cooldownInterval);
});

const resendButtonText = computed(() => {
  if (isLoading.value) return t('auth.forgotPassword.sending');
  if (resendCooldown.value > 0) return t('auth.forgotPassword.resendIn', { count: resendCooldown.value });
  return t('auth.forgotPassword.resend');
});

const startCooldown = () => {
  resendCooldown.value = RESEND_COOLDOWN_SECONDS;
  cooldownInterval = setInterval(() => {
    resendCooldown.value--;
    if (resendCooldown.value <= 0 && cooldownInterval) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
  }, 1000);
};

const submit = async () => {
  if (isLoading.value || resendCooldown.value > 0 || !isFormValid()) return;

  const isResend = isSent.value;
  isLoading.value = true;

  try {
    const { error } = await authClient.requestPasswordReset({
      email: form.value.email,
      redirectTo: `${window.location.origin}${router.resolve({ name: ROUTES_NAMES.resetPassword }).href}`,
    });

    if (error) {
      if (error.code === RESET_PASSWORD_DISABLED_CODE) {
        isResetDisabledByServer.value = true;
      } else {
        addErrorNotification(
          error.status === TOO_MANY_REQUESTS_STATUS
            ? t('auth.forgotPassword.errors.tooManyRequests')
            : t('auth.forgotPassword.genericError'),
        );
      }
      return;
    }

    // Same confirmation whether or not the account exists, so the form can't be used to probe emails.
    isSent.value = true;
    if (isResend) addSuccessNotification(t('auth.forgotPassword.resendSuccess'));
    startCooldown();
  } catch (error) {
    captureException({ error, context: { scope: 'auth:forgot-password' } });
    addErrorNotification(t('auth.forgotPassword.genericError'));
  } finally {
    isLoading.value = false;
  }
};
</script>
