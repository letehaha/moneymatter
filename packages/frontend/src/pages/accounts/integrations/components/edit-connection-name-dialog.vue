<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('pages.integrations.dialogs.editName.title') }}</DialogTitle>
        <DialogDescription>{{ t('pages.integrations.dialogs.editName.description') }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <InputField
          v-model="localProviderName"
          :label="t('pages.integrations.dialogs.editName.label')"
          :placeholder="$t('pages.connectionName.placeholder')"
          @keyup.enter="handleSave"
        />

        <ExternalUrlField
          v-model="localExternalUrl"
          :label="$t('pages.integrations.dialogs.editName.externalUrlLabel')"
          :placeholder="$t('pages.integrations.dialogs.editName.externalUrlPlaceholder')"
          :disabled="isSaving"
        />
      </div>

      <DialogFooter class="gap-2 sm:gap-4">
        <UiButton variant="outline" @click="handleCancel" :disabled="isSaving">
          {{ $t('common.actions.cancel') }}
        </UiButton>
        <UiButton @click="handleSave" :disabled="isSaveDisabled">
          {{
            isSaving ? t('pages.integrations.dialogs.editName.saving') : t('pages.integrations.dialogs.editName.save')
          }}
        </UiButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { normalizeExternalUrl, validateOptionalExternalUrl } from '@/common/utils/external-url';
import ExternalUrlField from '@/components/fields/external-url-field.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/lib/ui/dialog';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  open: boolean;
  providerName: string;
  externalUrl?: string | null;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  save: [payload: { providerName: string; externalUrl: string | null }];
}>();

const isOpen = ref(props.open);
const localProviderName = ref(props.providerName);
const localExternalUrl = ref(props.externalUrl ?? '');

const normalizedExternalUrl = computed(() => normalizeExternalUrl({ value: localExternalUrl.value }));
const isExternalUrlValid = computed(() => validateOptionalExternalUrl({ value: localExternalUrl.value }) === null);
const hasChanges = computed(
  () =>
    localProviderName.value.trim() !== props.providerName.trim() ||
    normalizedExternalUrl.value !== (props.externalUrl ?? null),
);
const isSaveDisabled = computed(
  () => !localProviderName.value.trim() || !isExternalUrlValid.value || !hasChanges.value || Boolean(props.isSaving),
);

watch(
  () => props.open,
  (newValue) => {
    isOpen.value = newValue;
    // Reset the local value when dialog opens
    if (newValue) {
      localProviderName.value = props.providerName;
      localExternalUrl.value = props.externalUrl ?? '';
    }
  },
);

watch(
  () => props.providerName,
  (newValue) => {
    localProviderName.value = newValue;
  },
);

watch(isOpen, (newValue) => {
  emit('update:open', newValue);
});

const handleSave = () => {
  if (!isSaveDisabled.value) {
    emit('save', {
      providerName: localProviderName.value.trim(),
      externalUrl: normalizedExternalUrl.value,
    });
  }
};

const handleCancel = () => {
  isOpen.value = false;
};
</script>
