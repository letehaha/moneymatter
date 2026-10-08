<template>
  <div class="mt-4 border-t pt-4">
    <div class="mb-2 flex items-center gap-2">
      <MessageSquareTextIcon class="text-muted-foreground size-4" />
      <h5 class="text-sm font-medium">{{ $t('settings.ai.customInstructions.title') }}</h5>
    </div>

    <p class="text-muted-foreground mb-3 text-xs leading-relaxed">
      {{ $t('settings.ai.customInstructions.description') }}
    </p>

    <TextareaField
      v-model="localInstructions"
      :placeholder="$t('settings.ai.customInstructions.placeholder')"
      :disabled="!canEdit"
      :maxlength="MAX_CHARS"
      rows="4"
    />

    <Callout v-if="credentialsUnknown" variant="destructive" class="mt-2 text-xs" icon-size-class="size-3.5">
      <p>{{ $t('settings.ai.customInstructions.credentialsCheckFailed') }}</p>
      <Button variant="ghost" size="sm" class="mt-2" :disabled="isFetchingConnections" @click="refetchConnections()">
        <Loader2Icon v-if="isFetchingConnections" class="size-3.5 animate-spin" />
        {{ $t('settings.ai.customInstructions.retryCredentialsCheck') }}
      </Button>
    </Callout>

    <Callout v-else-if="!hasOwnCredentials" variant="warning" class="mt-2 text-xs" icon-size-class="size-3.5">
      <p>{{ $t('settings.ai.customInstructions.requiresOwnCredentials') }}</p>
    </Callout>

    <!-- Instructions only reach the user's own models, never the included server one. -->
    <Callout v-else-if="isServedByServer" variant="warning" class="mt-2 text-xs" icon-size-class="size-3.5">
      <p>{{ $t('settings.ai.customInstructions.serverModelHint') }}</p>
    </Callout>

    <div v-if="canEdit" class="mt-3 flex items-center gap-3">
      <Button size="sm" :disabled="!hasChanges || isSaving" @click="handleSave">
        <Loader2Icon v-if="isSaving" class="size-3.5 animate-spin" />
        {{ $t('settings.ai.customInstructions.save') }}
      </Button>

      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <span v-if="showSuccess" class="text-success-text text-xs">
          {{ $t('settings.ai.customInstructions.saved') }}
        </span>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiConnectionsList } from '@/composable/data-queries/use-ai-connections';
import { AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH, AI_FEATURE } from '@bt/shared/types';
import { Loader2Icon, MessageSquareTextIcon } from '@lucide/vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const MAX_CHARS = AI_CUSTOM_INSTRUCTIONS_MAX_LENGTH;

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const {
  customInstructions,
  setCustomInstructions,
  isSettingCustomInstructions: isSaving,
  getFeatureStatus,
} = useAiSettings();
const { connections, isConnectionsError, isFetchingConnections, refetchConnections } = useAiConnectionsList();

const hasOwnCredentials = computed(() => connections.value.length > 0);
const credentialsUnknown = computed(() => isConnectionsError.value && !hasOwnCredentials.value);

const isServedByServer = computed(() => getFeatureStatus(AI_FEATURE.categorization)?.servedBy === 'server');
const canEdit = computed(() => hasOwnCredentials.value && !isServedByServer.value);

const localInstructions = ref('');
const isSyncingFromRemote = ref(false);
const userHasEdited = ref(false);
const showSuccess = ref(false);
let successTimeout: ReturnType<typeof setTimeout> | undefined;

const hasChanges = computed(() => {
  const saved = customInstructions.value ?? '';
  return localInstructions.value !== saved;
});

// Track when the user manually edits the textarea (not programmatic syncs)
watch(localInstructions, () => {
  if (!isSyncingFromRemote.value) {
    userHasEdited.value = true;
  }
});

// Sync local state when remote data loads, but only if user hasn't started editing
watch(
  customInstructions,
  (value) => {
    if (!userHasEdited.value) {
      isSyncingFromRemote.value = true;
      localInstructions.value = value ?? '';
      isSyncingFromRemote.value = false;
    }
  },
  { immediate: true },
);

onUnmounted(() => clearTimeout(successTimeout));

const handleSave = async () => {
  try {
    await setCustomInstructions({ instructions: localInstructions.value });
    userHasEdited.value = false;
    showSuccess.value = true;

    clearTimeout(successTimeout);
    const SUCCESS_DISPLAY_MS = 3000;
    successTimeout = setTimeout(() => {
      showSuccess.value = false;
    }, SUCCESS_DISPLAY_MS);
  } catch (error) {
    const message =
      (error as { response?: { message?: string } })?.response?.message ??
      t('settings.ai.customInstructions.saveFailed');
    addErrorNotification(message);
  }
};
</script>
