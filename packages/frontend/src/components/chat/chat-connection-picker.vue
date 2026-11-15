<script setup lang="ts">
import ConnectionModelSelect from '@/components/common/ai-connection-model/connection-model-select.vue';
import SelectField from '@/components/fields/select-field.vue';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiConnectionsList } from '@/composable/data-queries/use-ai-connections';
import { AI_FEATURE } from '@bt/shared/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type ChatConnectionOption,
  buildChatConnectionOptions,
  findSelectedChatConnectionOption,
} from './chat-connection-options';

const props = withDefaults(
  defineProps<{
    /** The connection the conversation runs on; null is the included model. */
    connectionId: string | null;
    /** The model picked within the connection; null is the connection's own model. */
    modelId?: string | null;
    disabled?: boolean;
  }>(),
  { modelId: null, disabled: false },
);

const emit = defineEmits<{ select: [connectionId: string | null]; 'select-model': [modelId: string | null] }>();

const { t } = useI18n();
const { connections } = useAiConnectionsList();
const { getFeatureStatus } = useAiSettings();

const options = computed(() =>
  buildChatConnectionOptions({
    connections: connections.value,
    hasIncludedModel: Boolean(getFeatureStatus(AI_FEATURE.chat)?.serverModelName),
  }),
);
const selected = computed(() =>
  findSelectedChatConnectionOption({ options: options.value, connectionId: props.connectionId }),
);

// The included model has no choice of model, and a connection gone from the list has nothing to list.
const selectedConnection = computed(() => connections.value.find(({ id }) => id === props.connectionId) ?? null);

// While the model select beside it names the model, the connection is named alone: its own model
// would read as a contradiction when another one is picked.
const hasModelChoice = ref(false);
const showsModelSelect = computed(() => hasModelChoice.value && selectedConnection.value !== null);

const formatOption = (option: ChatConnectionOption) => {
  if (option.kind === 'included') return t('chat.connection.included');

  if (showsModelSelect.value) {
    return option.needsAttention ? t('chat.connection.nameNeedsAttention', { name: option.name }) : option.name;
  }

  const params = { name: option.name, model: option.model };
  return option.needsAttention
    ? t('chat.connection.optionNeedsAttention', params)
    : t('chat.connection.option', params);
};

const onSelect = (option: ChatConnectionOption | null) => {
  if (option && option.connectionId !== props.connectionId) emit('select', option.connectionId);
};
</script>

<template>
  <div
    v-if="options.length > 0 || $slots.default"
    class="min-w-0 shrink-0 border-b px-3 py-2"
    role="group"
    :aria-label="$t('chat.connection.label')"
    data-testid="chat-connection-picker"
  >
    <!-- Always one row: each select takes half the width and truncates, to save vertical space on phones. -->
    <div v-if="options.length > 0" class="flex min-w-0 flex-row gap-2">
      <SelectField
        class="min-w-0 flex-1 basis-0 @md/chat-conversation:max-w-80"
        :model-value="selected"
        :values="options"
        :label-key="formatOption"
        value-key="value"
        :placeholder="$t('chat.connection.placeholder')"
        :disabled="disabled"
        @update:model-value="onSelect"
      >
        <template #trigger="{ label }">
          <span class="block truncate" :title="label">{{ label }}</span>
        </template>
      </SelectField>
      <ConnectionModelSelect
        v-if="selectedConnection"
        class="min-w-0 flex-1 basis-0 @md/chat-conversation:max-w-64"
        :connection="selectedConnection"
        :model-id="modelId"
        :disabled="disabled"
        @select="(next) => emit('select-model', next)"
        @update:has-choice="(value) => (hasModelChoice = value)"
      />
    </div>
    <!-- The thread's page context, on its own line under the selects. -->
    <div v-if="$slots.default" :class="options.length > 0 ? 'mt-2' : ''">
      <slot />
    </div>
  </div>
</template>
