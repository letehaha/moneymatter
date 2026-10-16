<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ title }}</template>

    <form class="@container/connection-dialog flex flex-col gap-4" @submit.prevent="handleSave">
      <SelectField
        :model-value="selectedPreset"
        :values="visiblePresets"
        :label-key="(preset: AiConnectionPreset) => t(preset.labelKey)"
        value-key="id"
        :label="$t('settings.ai.connections.form.providerLabel')"
        :placeholder="$t('settings.ai.connections.form.providerPlaceholder')"
        :disabled="isEditing || isBusy"
        @update:model-value="handlePresetChange"
      />

      <InputField
        v-model="form.name"
        :disabled="isBusy"
        :maxlength="AI_CONNECTION_NAME_MAX_LENGTH"
        :label="$t('settings.ai.connections.form.nameLabel')"
        :placeholder="$t(selectedPreset.namePlaceholderKey)"
        @update:model-value="resetFeedback"
      />

      <div v-if="isCustomProvider" class="flex flex-col gap-2">
        <InputField
          v-model="form.baseUrl"
          :disabled="isBusy"
          :label="$t('settings.ai.connections.form.baseUrlLabel')"
          :placeholder="$t('settings.ai.connections.form.baseUrlPlaceholder')"
          @update:model-value="resetFeedback"
        />

        <!-- Only a self-hosted backend can reach the user's own machine, so the Docker
        hostname tip belongs there and the reachability warning does not. -->
        <template v-if="selectedPreset.isLocal">
          <Callout v-if="config.isSelfHost" variant="info" class="text-xs">
            <i18n-t keypath="settings.ai.connections.form.dockerHost" tag="p">
              <template #dockerHost>
                <code class="bg-muted rounded px-1 py-0.5 font-mono break-all">host.docker.internal</code>
              </template>
              <template #ip>
                <code class="bg-muted rounded px-1 py-0.5 font-mono break-all">127.0.0.1</code>
              </template>
            </i18n-t>
          </Callout>
          <Callout v-else variant="warning" class="text-xs">
            <i18n-t keypath="settings.ai.connections.form.localNetworkOnly" tag="p">
              <template #hostname>
                <code class="bg-muted rounded px-1 py-0.5 font-mono break-all">localhost</code>
              </template>
              <template #ip>
                <code class="bg-muted rounded px-1 py-0.5 font-mono break-all">127.0.0.1</code>
              </template>
            </i18n-t>
          </Callout>
        </template>
      </div>

      <div>
        <InputField
          v-model="form.apiKey"
          :disabled="isBusy"
          type="password"
          :label="$t('settings.ai.connections.form.apiKeyLabel')"
          :placeholder="$t('settings.ai.connections.form.apiKeyPlaceholder')"
          @update:model-value="resetFeedback"
        />

        <p v-if="borrowedKeySource" class="text-muted-foreground mt-1.5 text-xs">
          {{ $t('settings.ai.connections.form.apiKeyBorrowedHint', { name: borrowedKeySource.name }) }}
        </p>
        <div v-else-if="hasSavedApiKey" class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p class="text-muted-foreground text-xs">{{ $t('settings.ai.connections.form.apiKeySavedHint') }}</p>
          <Button
            v-if="!selectedPreset.keyRequired"
            type="button"
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            :disabled="isBusy"
            @click="isRemoveKeyDialogOpen = true"
          >
            {{ $t('settings.ai.connections.form.removeApiKeyButton') }}
          </Button>
        </div>
        <i18n-t
          v-else-if="selectedPreset.keyUrl"
          keypath="settings.ai.connections.form.apiKeyGetHint"
          tag="p"
          class="text-muted-foreground mt-1.5 text-xs"
        >
          <template #link>
            <a
              :href="selectedPreset.keyUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-text hover:underline"
            >
              {{ keyUrlHost }}
            </a>
          </template>
        </i18n-t>
        <p v-else class="text-muted-foreground mt-1.5 text-xs">
          {{ $t('settings.ai.connections.form.apiKeyOptionalHint') }}
        </p>
      </div>

      <AutocompleteField
        v-model="form.model"
        :disabled="isBusy"
        :suggestions="liveModels"
        :loading="isLoadingLiveModels"
        :maxlength="AI_MODEL_NAME_MAX_LENGTH"
        :label="$t('settings.ai.connections.form.modelLabel')"
        :placeholder="$t('settings.ai.connections.form.modelPlaceholder')"
        :empty-text="$t('settings.ai.connections.form.modelListEmpty')"
        :no-match-text="$t('settings.ai.connections.form.modelListNoMatch')"
        @update:model-value="resetFeedback"
      />

      <p v-if="formError" class="text-destructive-text text-sm">{{ formError }}</p>

      <div v-if="testResult" class="flex items-start gap-2 text-sm">
        <CheckCircleIcon v-if="testResult.isValid" class="text-success-text mt-0.5 size-4 shrink-0" />
        <AlertCircleIcon v-else class="text-destructive-text mt-0.5 size-4 shrink-0" />
        <span :class="testResult.isValid ? 'text-success-text' : 'text-destructive-text'">
          {{ testResult.message }}
        </span>
      </div>

      <div class="flex flex-col gap-2 pt-2 @sm/connection-dialog:flex-row @sm/connection-dialog:items-center">
        <Button type="button" variant="outline" :disabled="!canTest" @click="handleTest">
          <Loader2Icon v-if="isTestingConnection" class="size-4 animate-spin" />
          <PlugZapIcon v-else class="size-4" />
          {{ $t('settings.ai.connections.form.testButton') }}
        </Button>

        <div class="flex flex-col gap-2 @sm/connection-dialog:ml-auto @sm/connection-dialog:flex-row">
          <Button type="button" variant="ghost" :disabled="isBusy" @click="isOpen = false">
            {{ $t('common.actions.cancel') }}
          </Button>
          <Button type="submit" :disabled="!canSubmit">
            <Loader2Icon v-if="isSaving" class="size-4 animate-spin" />
            {{ isEditing ? $t('settings.ai.connections.form.saveButton') : $t('settings.ai.connections.addButton') }}
          </Button>
        </div>
      </div>
    </form>
  </ResponsiveDialog>

  <ResponsiveAlertDialog
    v-model:open="isRemoveKeyDialogOpen"
    :confirm-label="$t('settings.ai.connections.removeKeyDialog.confirm')"
    confirm-variant="destructive"
    @confirm="confirmRemoveApiKey"
  >
    <template #title>{{ $t('settings.ai.connections.removeKeyDialog.title') }}</template>
    <template #description>{{ $t('settings.ai.connections.removeKeyDialog.description') }}</template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { config } from '@/common/config';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AutocompleteField from '@/components/fields/autocomplete-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { useAiConnectionModels } from '@/composable/data-queries/use-ai-connection-models';
import { useAiConnections } from '@/composable/data-queries/use-ai-connections';
import { useCliAiAvailability } from '@/composable/data-queries/use-cli-ai-availability';
import { extractApiErrorMessage } from '@/js/errors';
import {
  AIConnectionInfo,
  AI_CONNECTION_NAME_MAX_LENGTH,
  AI_MODEL_NAME_MAX_LENGTH,
  AI_PROVIDER,
  TestAIConnectionBody,
} from '@bt/shared/types';
import { AlertCircleIcon, CheckCircleIcon, Loader2Icon, PlugZapIcon } from '@lucide/vue';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { AI_CONNECTION_PRESETS, type AiConnectionPreset, findPresetForConnection, getVisiblePresets } from '../presets';

const props = defineProps<{
  /** Set when editing */
  connection?: AIConnectionInfo | null;
  /** Set when duplicating: prefills the form and lends its key */
  source?: AIConnectionInfo | null;
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification, addWarningNotification } = useNotificationCenter();

const {
  createConnection,
  isCreatingConnection,
  updateConnection,
  isUpdatingConnection,
  testConnection,
  isTestingConnection,
} = useAiConnections();

const { availability: cliAvailability } = useCliAiAvailability();
// Subscription presets only show for an admin on a self-hosted backend that has the CLIs installed.
const visiblePresets = computed(() =>
  getVisiblePresets({ availability: cliAvailability.value }).filter((preset) => !preset.disabled),
);

const selectedPreset = ref<AiConnectionPreset>(AI_CONNECTION_PRESETS[0]!);
const form = reactive({
  name: '',
  baseUrl: '',
  model: '',
  apiKey: '',
});

const formError = ref('');
const testResult = ref<{ isValid: boolean; message: string } | null>(null);
const isRemoveKeyDialogOpen = ref(false);

const resetFeedback = () => {
  formError.value = '';
  testResult.value = null;
};

// Seeded on open only, so a refetch from inside the dialog never overwrites what the user is typing.
watch(
  isOpen,
  (open) => {
    if (!open) return;
    const base = props.connection ?? props.source ?? null;
    selectedPreset.value = base ? findPresetForConnection({ connection: base }) : AI_CONNECTION_PRESETS[0]!;
    form.name =
      props.connection?.name ??
      (props.source
        ? t('settings.ai.connections.duplicateName', { name: props.source.name }).slice(
            0,
            AI_CONNECTION_NAME_MAX_LENGTH,
          )
        : '');
    form.baseUrl = base?.baseUrl ?? '';
    form.model = base?.model ?? '';
    form.apiKey = '';
    isRemoveKeyDialogOpen.value = false;
    resetFeedback();
  },
  { immediate: true },
);

const isEditing = computed(() => Boolean(props.connection));
const isCustomProvider = computed(() => selectedPreset.value.provider === AI_PROVIDER.custom);
const hasSavedApiKey = computed(() => props.connection?.hasApiKey ?? false);

const title = computed(() => {
  if (props.connection) return t('settings.ai.connections.form.titleEdit');
  if (props.source) return t('settings.ai.connections.form.titleDuplicate');
  return t('settings.ai.connections.form.titleAdd');
});

const typedKey = computed(() => form.apiKey.trim());
const trimmedBaseUrl = computed(() => form.baseUrl.trim());
const trimmedModel = computed(() => form.model.trim());
const requestBaseUrl = computed(() => (isCustomProvider.value ? trimmedBaseUrl.value : undefined));
const requestApiKey = computed(() => typedKey.value || undefined);

/** A duplicate reuses the source's stored key until the user types one. */
const borrowedKeySource = computed(() => {
  const source = props.source;
  if (props.connection || !source || typedKey.value) return null;
  return source.hasApiKey && source.provider === selectedPreset.value.provider ? source : null;
});

const keyKnown = computed(() => Boolean(typedKey.value) || hasSavedApiKey.value || Boolean(borrowedKeySource.value));
const hasRequiredFields = computed(
  () =>
    Boolean(trimmedModel.value) &&
    (!isCustomProvider.value || Boolean(trimmedBaseUrl.value)) &&
    (!selectedPreset.value.keyRequired || keyKnown.value),
);

const isSaving = computed(() => isCreatingConnection.value || isUpdatingConnection.value);
const isBusy = computed(() => isSaving.value || isTestingConnection.value);

const canSubmit = computed(() => hasRequiredFields.value && Boolean(form.name.trim()) && !isBusy.value);
const canTest = computed(() => hasRequiredFields.value && !isBusy.value);

const keyUrlHost = computed(() => (selectedPreset.value.keyUrl ? new URL(selectedPreset.value.keyUrl).host : ''));

const { liveModels, isLoadingLiveModels } = useAiConnectionModels({
  params: () => ({
    provider: selectedPreset.value.provider,
    baseUrl: requestBaseUrl.value,
    apiKey: requestApiKey.value,
    connectionId: props.connection?.id ?? borrowedKeySource.value?.id,
  }),
  enabled: isOpen,
});

const handlePresetChange = (preset: AiConnectionPreset | null) => {
  if (!preset || preset.id === selectedPreset.value.id) return;
  selectedPreset.value = preset;
  form.baseUrl = preset.baseUrl ?? '';
  form.model = '';
  form.apiKey = '';
  resetFeedback();
};

const handleSave = async () => {
  if (!canSubmit.value) return;

  resetFeedback();

  try {
    if (props.connection) {
      await updateConnection({
        id: props.connection.id,
        name: form.name.trim(),
        model: trimmedModel.value,
        baseUrl: requestBaseUrl.value,
        // A blank field keeps whatever key is already stored
        apiKey: requestApiKey.value,
      });
    } else {
      await createConnection({
        provider: selectedPreset.value.provider,
        name: form.name.trim(),
        model: trimmedModel.value,
        baseUrl: requestBaseUrl.value,
        apiKey: requestApiKey.value,
        keyFromConnectionId: borrowedKeySource.value?.id,
      });
    }
    addSuccessNotification(t('settings.ai.connections.notifications.saveSuccess'));
    isOpen.value = false;
  } catch (error) {
    formError.value = extractApiErrorMessage(error) ?? t('settings.ai.connections.notifications.saveFailed');
  }
};

const handleTest = async () => {
  if (!canTest.value) return;

  resetFeedback();

  const baseUrl = requestBaseUrl.value;
  const apiKey = requestApiKey.value;
  const body: TestAIConnectionBody = props.connection
    ? { connectionId: props.connection.id, model: trimmedModel.value, baseUrl, apiKey }
    : {
        provider: selectedPreset.value.provider,
        model: trimmedModel.value,
        baseUrl,
        apiKey,
        keyFromConnectionId: borrowedKeySource.value?.id,
      };

  try {
    const result = await testConnection(body);
    testResult.value = {
      isValid: result.isValid,
      message: result.isValid ? t('settings.ai.connections.test.success') : result.error,
    };
  } catch (error) {
    testResult.value = {
      isValid: false,
      message: extractApiErrorMessage(error) ?? t('settings.ai.connections.test.failed'),
    };
  }
};

const confirmRemoveApiKey = async () => {
  isRemoveKeyDialogOpen.value = false;
  if (!props.connection) return;

  resetFeedback();

  try {
    // Only `apiKey: null` is sent: omitted fields keep their stored values, and the
    // form may hold edits the user has not saved yet.
    const updated = await updateConnection({ id: props.connection.id, apiKey: null });
    form.apiKey = '';

    // The key is dropped even if the server stops answering without it, so a 200 can come back invalid.
    if (updated.status === 'invalid') {
      const message = t('settings.ai.connections.notifications.removeKeyInvalid', {
        reason: updated.lastError ?? t('settings.ai.connections.test.failed'),
      });
      formError.value = message;
      addWarningNotification(message);
      return;
    }

    addSuccessNotification(t('settings.ai.connections.notifications.removeKeySuccess'));
  } catch (error) {
    formError.value = extractApiErrorMessage(error) ?? t('settings.ai.connections.notifications.removeKeyFailed');
  }
};
</script>
