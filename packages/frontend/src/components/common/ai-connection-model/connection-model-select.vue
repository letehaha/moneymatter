<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import { useAiConnectionModels } from '@/composable/data-queries/use-ai-connection-models';
import { type AIConnectionInfo } from '@bt/shared/types';
import { computed, onBeforeUnmount, watch } from 'vue';

import {
  type ConnectionModelOption,
  buildConnectionModelOptions,
  findSelectedConnectionModelOption,
} from './connection-model-options';

const props = withDefaults(
  defineProps<{
    connection: Pick<AIConnectionInfo, 'id' | 'provider' | 'model' | 'baseUrl'>;
    /** The model picked within the connection; null is the connection's own model. */
    modelId: string | null;
    disabled?: boolean;
    label?: string;
  }>(),
  { disabled: false, label: undefined },
);

const emit = defineEmits<{ select: [modelId: string | null]; 'update:hasChoice': [hasChoice: boolean] }>();

const { liveModels, isLoadingLiveModels } = useAiConnectionModels({
  params: () => ({
    provider: props.connection.provider,
    baseUrl: props.connection.baseUrl,
    connectionId: props.connection.id,
  }),
  enabled: true,
});

const options = computed(() =>
  buildConnectionModelOptions({
    connection: props.connection,
    liveModels: liveModels.value,
    selectedModelId: props.modelId,
  }),
);
const selected = computed(() => findSelectedConnectionModelOption({ options: options.value, modelId: props.modelId }));

// A provider that lists nothing leaves only the default, which is no choice to offer.
const hasChoice = computed(() => options.value.length > 1 || isLoadingLiveModels.value);

// The connection select beside this one drops the model from its labels while this one names it.
watch(hasChoice, (value) => emit('update:hasChoice', value), { immediate: true });
onBeforeUnmount(() => emit('update:hasChoice', false));

const formatOption = (option: ConnectionModelOption) => option.name;

const onSelect = (option: ConnectionModelOption | null) => {
  if (!option) return;
  const next = option.kind === 'default' ? null : option.value;
  if (next !== props.modelId) emit('select', next);
};
</script>

<template>
  <SelectField
    v-if="hasChoice"
    :model-value="selected"
    :values="options"
    :label-key="formatOption"
    value-key="value"
    :label="label"
    :placeholder="$t('ai.connectionModel.placeholder')"
    :disabled="disabled"
    @update:model-value="onSelect"
  >
    <template #trigger="{ label: triggerLabel }">
      <span class="block truncate" :title="triggerLabel">{{ triggerLabel }}</span>
    </template>
    <template #item="{ item, label: itemLabel }">
      <span class="flex items-baseline gap-2">
        <span>{{ itemLabel }}</span>
        <span v-if="item.kind === 'default'" class="text-muted-foreground text-xs">
          {{ $t('ai.connectionModel.defaultTag') }}
        </span>
      </span>
    </template>
  </SelectField>
</template>
