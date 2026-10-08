<template>
  <div class="space-y-6">
    <div>
      <h3 class="mb-1 text-lg font-medium">{{ $t('settings.security.passwordSection.title') }}</h3>
      <p class="text-muted-foreground text-sm">
        {{
          hasPassword
            ? $t('settings.security.passwordSection.descriptionChange')
            : $t('settings.security.passwordSection.descriptionSet')
        }}
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Loader2Icon class="text-muted-foreground size-6 animate-spin" />
    </div>

    <template v-else>
      <!-- Demo mode restriction notice -->
      <div v-if="isDemo" class="bg-muted/50 text-muted-foreground flex items-center gap-3 rounded-lg border p-4">
        <AlertCircleIcon class="size-5 shrink-0" />
        <p class="text-sm">
          {{ $t('demo.passwordChangeRestricted') }}
        </p>
      </div>

      <!-- Password form -->
      <form class="max-w-md space-y-4" @submit.prevent="handleSubmit">
        <!-- Current password (only when changing) -->
        <InputField
          v-if="hasPassword"
          v-model="form.currentPassword"
          :label="$t('settings.security.passwordSection.labels.currentPassword')"
          type="password"
          :disabled="isSubmitting || isDemo"
          :placeholder="$t('settings.security.passwordSection.placeholders.currentPassword')"
          :error-message="getFieldErrorMessage('form.currentPassword')"
        />

        <!-- New password -->
        <div class="space-y-2">
          <InputField
            v-model="form.newPassword"
            :label="
              hasPassword
                ? $t('settings.security.passwordSection.labels.newPassword')
                : $t('settings.security.passwordSection.labels.password')
            "
            type="password"
            :disabled="isSubmitting || isDemo"
            :placeholder="$t('settings.security.passwordSection.placeholders.newPassword')"
            :error-message="getFieldErrorMessage('form.newPassword')"
          />
          <!-- Password strength indicator -->
          <div v-if="form.newPassword" class="space-y-1">
            <div class="flex gap-1">
              <div
                v-for="i in 4"
                :key="i"
                :class="[
                  'h-1 flex-1 rounded-full',
                  i <= passwordStrength ? strengthColors[passwordStrength] : 'bg-muted',
                ]"
              />
            </div>
            <p :class="['text-xs', strengthTextColors[passwordStrength]]">
              {{ strengthLabels[passwordStrength] }}
            </p>
          </div>
        </div>

        <!-- Confirm password -->
        <InputField
          v-model="form.confirmPassword"
          :label="$t('settings.security.passwordSection.labels.confirmPassword')"
          type="password"
          :disabled="isSubmitting || isDemo"
          :placeholder="$t('settings.security.passwordSection.placeholders.confirmPassword')"
          :error-message="getFieldErrorMessage('form.confirmPassword')"
        />

        <!-- Error message -->
        <p v-if="errorMessage" class="text-destructive-text text-sm">{{ errorMessage }}</p>

        <!-- Submit button -->
        <DemoRestricted feature="change_password">
          <Button type="submit" :disabled="isSubmitting || isDemo">
            <Loader2Icon v-if="isSubmitting" class="mr-2 size-4 animate-spin" />
            {{
              hasPassword
                ? $t('settings.security.passwordSection.buttons.change')
                : $t('settings.security.passwordSection.buttons.set')
            }}
          </Button>
        </DemoRestricted>
      </form>

      <!-- Info text -->
      <div class="border-t pt-4">
        <h4 class="mb-2 text-sm font-medium">{{ $t('settings.security.passwordSection.requirements.title') }}</h4>
        <ul class="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>{{ $t('settings.security.passwordSection.requirements.minLength') }}</li>
          <li>{{ $t('settings.security.passwordSection.requirements.mixedCase') }}</li>
          <li>{{ $t('settings.security.passwordSection.requirements.specialChars') }}</li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import { minLength, required, sameAs } from '@/js/helpers/validators';
import { authClient, setPassword } from '@/lib/auth-client';
import { useUserStore } from '@/stores';
import { AlertCircleIcon, Loader2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

interface Account {
  id: string;
  providerId: string;
}

const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const { t } = useI18n();
const userStore = useUserStore();
const { isDemo } = storeToRefs(userStore);

const isLoading = ref(true);
const isSubmitting = ref(false);
const hasPassword = ref(false);
const errorMessage = ref('');

const form = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const { isFormValid, getFieldErrorMessage, resetValidation } = useFormValidation(
  { form },
  {
    form: {
      currentPassword: { required },
      newPassword: {
        required,
        minLength: minLength(8),
      },
      confirmPassword: {
        required,
        sameAsPassword: sameAs(computed(() => form.value.newPassword)),
      },
    },
  },
  undefined,
  {
    customValidationMessages: {
      minLength: t('settings.security.passwordSection.validation.minLength'),
      sameAsPassword: t('settings.security.passwordSection.validation.passwordsNoMatch'),
    },
  },
);

const strengthColors: Record<number, string> = {
  0: 'bg-destructive',
  1: 'bg-destructive',
  2: 'bg-yellow-500',
  3: 'bg-green-400',
  4: 'bg-green-500',
};

const strengthTextColors: Record<number, string> = {
  0: 'text-destructive-text',
  1: 'text-destructive-text',
  2: 'text-yellow-600',
  3: 'text-green-600',
  4: 'text-green-600',
};

const strengthLabels = computed<Record<number, string>>(() => ({
  0: t('settings.security.passwordSection.strength.veryWeak'),
  1: t('settings.security.passwordSection.strength.weak'),
  2: t('settings.security.passwordSection.strength.fair'),
  3: t('settings.security.passwordSection.strength.strong'),
  4: t('settings.security.passwordSection.strength.veryStrong'),
}));

const passwordStrength = computed(() => {
  const password = form.value.newPassword;
  if (!password) return 0;

  let score = 0;

  // Length
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;

  // Character types
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  return Math.min(score, 4);
});

const loadPasswordStatus = async () => {
  try {
    const result = await authClient.listAccounts();
    if (result.data) {
      hasPassword.value = result.data.some((a: Account) => a.providerId === 'credential');
    }
  } catch (e) {
    console.error('Failed to load account status:', e);
  }
};

/**
 * App-owned auth routes answer with `{ status, response: { message, code } }`, which the
 * better-auth fetch client spreads into `error`; native better-auth errors keep both at
 * the top level.
 */
const resolveAuthError = (error: {
  message?: string;
  code?: string;
  response?: { message?: string; code?: string };
}) => ({
  message: error.message || error.response?.message,
  code: error.code ?? error.response?.code,
});

const handleSubmit = async () => {
  // Skip current password validation for OAuth-only users
  if (!isFormValid(hasPassword.value ? 'form' : 'form.newPassword') || !isFormValid('form.confirmPassword')) {
    return;
  }

  errorMessage.value = '';

  try {
    isSubmitting.value = true;

    if (hasPassword.value) {
      // Change password
      const result = await authClient.changePassword({
        currentPassword: form.value.currentPassword,
        newPassword: form.value.newPassword,
      });

      if (result.error) {
        const { message } = resolveAuthError(result.error);
        errorMessage.value = message || t('settings.security.passwordSection.notifications.changeFailed');
        return;
      }

      addSuccessNotification(t('settings.security.passwordSection.notifications.changeSuccess'));
    } else {
      // Set password for OAuth-only accounts
      const result = await setPassword({ newPassword: form.value.newPassword });

      if (result.error) {
        const { message, code } = resolveAuthError(result.error);
        errorMessage.value = message || t('settings.security.passwordSection.notifications.setFailed');
        // The mount-time provider probe can be stale or have failed, so trust the server
        // over `hasPassword` and switch the form to its change-password variant.
        if (code === 'PASSWORD_ALREADY_SET') hasPassword.value = true;
        return;
      }

      hasPassword.value = true;
      addSuccessNotification(t('settings.security.passwordSection.notifications.setSuccess'));
    }

    // Clear form and reset validation
    form.value.currentPassword = '';
    form.value.newPassword = '';
    form.value.confirmPassword = '';
    resetValidation();
  } catch {
    errorMessage.value = t('settings.security.passwordSection.notifications.unexpectedError');
    addErrorNotification(t('settings.security.passwordSection.notifications.updateFailed'));
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(async () => {
  isLoading.value = true;
  await loadPasswordStatus();
  isLoading.value = false;
});
</script>
