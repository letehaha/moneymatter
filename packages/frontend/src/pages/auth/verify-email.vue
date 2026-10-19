<template>
  <div class="flex h-dvh items-center justify-center px-6">
    <Card class="w-full max-w-112.5">
      <CardHeader class="text-center">
        <div class="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <MailIcon class="text-primary-text h-8 w-8" />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">{{ $t('auth.verifyEmail.title') }}</h1>
      </CardHeader>
      <CardContent class="text-center">
        <p class="text-muted-foreground mb-6">
          {{ $t('auth.verifyEmail.description') }}
          <span v-if="email" class="text-foreground font-medium">{{ email }}</span>
          <span v-else>{{ $t('auth.verifyEmail.descriptionYourEmail') }}</span
          >{{ $t('auth.verifyEmail.descriptionContinued') }}
        </p>

        <div class="bg-muted/50 text-muted-foreground rounded-lg p-4 text-sm">
          <p>{{ $t('auth.verifyEmail.didntReceive') }}</p>
          <Button
            variant="link"
            class="text-primary-text h-auto p-0"
            :disabled="isResending || resendCooldown > 0"
            @click="handleResend"
          >
            {{ resendButtonText }}
          </Button>
        </div>
      </CardContent>
      <CardFooter class="flex-col gap-3">
        <router-link :to="{ name: ROUTES_NAMES.signIn }" class="w-full">
          <Button variant="outline" class="w-full"> {{ $t('auth.verifyEmail.backToSignIn') }} </Button>
        </router-link>
      </CardFooter>
    </Card>
  </div>
</template>

<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/lib/ui/card';
import { useNotificationCenter } from '@/components/notification-center';
import { UnexpectedError, getAuthErrorMessage } from '@/js/errors';
import { authClient } from '@/lib/auth-client';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore } from '@/stores';
import { MailIcon } from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const router = useRouter();
const authStore = useAuthStore();
const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const email = ref<string | null>(null);
const isResending = ref(false);
const resendCooldown = ref(0);
let cooldownInterval: ReturnType<typeof setInterval> | null = null;

// Check if user is already logged in (verified) - redirect to dashboard
// Get email from sessionStorage (set during signup) - prevents URL manipulation
onMounted(async () => {
  // If already logged in, redirect to dashboard
  if (authStore.isLoggedIn) {
    router.replace({ name: ROUTES_NAMES.home });
    return;
  }

  // Check session in case user just verified
  const isValid = await authStore.validateSession();
  if (isValid) {
    router.replace({ name: ROUTES_NAMES.home });
    return;
  }

  // Get email from sessionStorage (set during signup)
  // This prevents attackers from accessing this page with arbitrary emails
  const storedEmail = sessionStorage.getItem('verify_email_address');
  if (storedEmail) {
    email.value = storedEmail;
  } else {
    // No email in session - user didn't come from signup flow
    router.replace({ name: ROUTES_NAMES.signUp });
  }
});

onUnmounted(() => {
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
  }
  // Clear stored email when leaving (prevents reuse)
  sessionStorage.removeItem('verify_email_address');
});

const resendButtonText = computed(() => {
  if (isResending.value) return t('auth.verifyEmail.sending');
  if (resendCooldown.value > 0) return t('auth.verifyEmail.resendIn', { count: resendCooldown.value });
  return t('auth.verifyEmail.resend');
});

const startCooldown = () => {
  resendCooldown.value = 60;
  cooldownInterval = setInterval(() => {
    resendCooldown.value--;
    if (resendCooldown.value <= 0 && cooldownInterval) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
  }, 1000);
};

const handleResend = async () => {
  if (!email.value || isResending.value || resendCooldown.value > 0) return;

  try {
    isResending.value = true;
    const { error } = await authClient.sendVerificationEmail({
      email: email.value,
      callbackURL: `${window.location.origin}/auth/callback`,
    });
    if (error) throw new UnexpectedError(error.message, error);
    addSuccessNotification(t('auth.verifyEmail.resendSuccess'));
    startCooldown();
  } catch (error) {
    addErrorNotification(await getAuthErrorMessage({ error, fallbackKey: 'auth.verifyEmail.resendError' }));
  } finally {
    isResending.value = false;
  }
};
</script>
