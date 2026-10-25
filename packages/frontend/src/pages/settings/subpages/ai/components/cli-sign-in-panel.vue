<template>
  <div class="bg-muted/30 @container/cli-sign-in flex flex-col gap-3 rounded-lg border p-3">
    <!-- One live region for every state, so assistive tech announces each transition. -->
    <div role="status" aria-live="polite" class="flex flex-col gap-3">
      <template v-if="state === 'idle'">
        <p v-if="isReauth" class="text-muted-foreground text-xs">{{ $t('settings.ai.connections.cli.editHint') }}</p>
        <p v-if="isCodex" class="text-muted-foreground text-xs">
          {{ $t('settings.ai.connections.cli.codex.deviceCodeHint') }}
        </p>
        <div>
          <Button
            type="button"
            :variant="isReauth ? 'outline' : 'default'"
            :disabled="disabled"
            @click="signIn.start()"
          >
            <LogInIcon class="size-4" />
            {{ isReauth ? $t('settings.ai.connections.actions.signInAgain') : signInLabel }}
          </Button>
        </div>
      </template>

      <template v-else-if="state === 'starting'">
        <p class="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon class="size-4 shrink-0 animate-spin" />
          {{ $t('settings.ai.connections.cli.starting') }}
        </p>
        <div>
          <Button type="button" variant="ghost" size="sm" @click="signIn.cancel()">
            {{ $t('settings.ai.connections.cli.cancel') }}
          </Button>
        </div>
      </template>

      <template v-else-if="state === 'awaiting-user'">
        <template v-if="isCodex">
          <p class="text-sm">{{ $t('settings.ai.connections.cli.codex.awaiting') }}</p>

          <div v-if="userCode" class="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              class="h-auto px-4 py-2 font-mono text-2xl tracking-widest"
              :aria-label="$t('settings.ai.connections.cli.codex.copyCode')"
              @click="copyUserCode"
            >
              {{ userCode }}
              <CheckIcon v-if="isCodeCopied" class="text-success-text size-5" />
              <CopyIcon v-else class="text-muted-foreground size-5" />
            </Button>
          </div>

          <a
            v-if="authUrl"
            :href="authUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-text inline-flex w-fit items-center gap-1 text-sm hover:underline"
          >
            {{ $t('settings.ai.connections.cli.openSignInPage') }}
            <ExternalLinkIcon class="size-3.5" />
          </a>

          <p class="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2Icon class="size-3.5 shrink-0 animate-spin" />
            {{ $t('settings.ai.connections.cli.codex.waiting') }}
          </p>
          <p class="text-muted-foreground text-xs">
            {{ $t('settings.ai.connections.cli.codex.deviceCodeHint') }}
          </p>
        </template>

        <template v-else>
          <p class="text-sm">{{ $t('settings.ai.connections.cli.claudeCode.awaiting') }}</p>

          <a
            v-if="authUrl"
            :href="authUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-text inline-flex w-fit items-center gap-1 text-sm hover:underline"
          >
            {{ $t('settings.ai.connections.cli.openSignInPage') }}
            <ExternalLinkIcon class="size-3.5" />
          </a>

          <InputField
            v-model="code"
            :label="$t('settings.ai.connections.cli.codeLabel')"
            :placeholder="$t('settings.ai.connections.cli.codePlaceholder')"
            :disabled="disabled"
            @keydown.enter.prevent="submitCode"
          />

          <p v-if="error" class="text-destructive-text text-xs break-words">{{ error }}</p>

          <div class="flex flex-col gap-2 @sm/cli-sign-in:flex-row">
            <Button type="button" :disabled="disabled || !trimmedCode" @click="submitCode">
              {{ $t('settings.ai.connections.cli.submitCode') }}
            </Button>
            <Button type="button" variant="ghost" @click="signIn.cancel()">
              {{ $t('settings.ai.connections.cli.cancel') }}
            </Button>
          </div>
        </template>

        <div v-if="isCodex">
          <Button type="button" variant="ghost" size="sm" @click="signIn.cancel()">
            {{ $t('settings.ai.connections.cli.cancel') }}
          </Button>
        </div>
      </template>

      <template v-else-if="state === 'verifying'">
        <p class="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon class="size-4 shrink-0 animate-spin" />
          {{ $t('settings.ai.connections.cli.verifying') }}
        </p>
        <div>
          <Button type="button" variant="ghost" size="sm" @click="signIn.cancel()">
            {{ $t('settings.ai.connections.cli.cancel') }}
          </Button>
        </div>
      </template>

      <template v-else-if="state === 'succeeded'">
        <p class="text-success-text flex items-center gap-2 text-sm">
          <CheckCircleIcon class="size-4 shrink-0" />
          {{ isReauth ? $t('settings.ai.connections.cli.succeeded') : $t('settings.ai.connections.cli.succeededSave') }}
        </p>
        <div>
          <Button type="button" variant="ghost" size="sm" :disabled="disabled" @click="signIn.start()">
            {{ $t('settings.ai.connections.actions.signInAgain') }}
          </Button>
        </div>
      </template>

      <template v-else>
        <div class="flex items-start gap-2 text-sm">
          <AlertCircleIcon class="text-destructive-text mt-0.5 size-4 shrink-0" />
          <div class="text-destructive-text min-w-0">
            <p>
              {{
                state === 'expired'
                  ? $t('settings.ai.connections.cli.expired')
                  : $t('settings.ai.connections.cli.failed')
              }}
            </p>
            <p v-if="error" class="text-xs break-words">{{ error }}</p>
          </div>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" :disabled="disabled" @click="signIn.start()">
            <RotateCwIcon class="size-4" />
            {{ $t('settings.ai.connections.cli.retry') }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import InputField from '@/components/fields/input-field.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { AICliProvider, AI_PROVIDER } from '@bt/shared/types';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  LogInIcon,
  RotateCwIcon,
} from '@lucide/vue';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useCliSignIn } from '../composables/use-cli-sign-in';

const CODE_COPIED_FEEDBACK_MS = 2000;

const props = defineProps<{
  provider: AICliProvider;
  /** Label of the button that starts the first sign-in. */
  signInLabel: string;
  /** The connection already holds a sign-in; the panel offers to replace it. */
  isReauth?: boolean;
  disabled?: boolean;
}>();

/** Set only while a finished sign-in is waiting to be saved, else null. */
const sessionId = defineModel<string | null>('sessionId', { default: null });
/** True while a sign-in is running, so the parent can hold its save back. */
const isInProgress = defineModel<boolean>('inProgress', { default: false });

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();

const signIn = useCliSignIn({ provider: () => props.provider });
const { state, authUrl, userCode, error } = signIn;

const isCodex = computed(() => props.provider === AI_PROVIDER.codex);

const code = ref('');
const trimmedCode = computed(() => code.value.trim());

watch(
  () => (state.value === 'succeeded' ? signIn.sessionId.value : null),
  (id) => {
    sessionId.value = id;
  },
  { immediate: true },
);

watch(
  signIn.isInProgress,
  (value) => {
    isInProgress.value = value;
  },
  { immediate: true },
);

// A rejected code keeps the session waiting, so the field keeps what was typed; any other step starts clean.
watch(state, (value) => {
  if (value !== 'awaiting-user' && value !== 'verifying') code.value = '';
});

const submitCode = () => {
  if (props.disabled || !trimmedCode.value) return;
  signIn.submitCode({ code: trimmedCode.value });
};

const isCodeCopied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const copyUserCode = async () => {
  if (!userCode.value) return;

  try {
    await navigator.clipboard.writeText(userCode.value);
    isCodeCopied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      isCodeCopied.value = false;
    }, CODE_COPIED_FEEDBACK_MS);
  } catch {
    addErrorNotification(t('common.errors.copyToClipboardFailed'));
  }
};

onScopeDispose(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>
