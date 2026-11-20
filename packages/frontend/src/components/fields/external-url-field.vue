<script setup lang="ts">
import { MAX_EXTERNAL_URL_LENGTH, safeExternalUrl, validateOptionalExternalUrl } from '@/common/utils/external-url';
import InputField from '@/components/fields/input-field.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { ExternalLinkIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    placeholder: string;
    disabled?: boolean;
    errorMessage?: string;
    showError?: boolean;
    autofocus?: boolean;
  }>(),
  { disabled: false, showError: false, autofocus: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [];
}>();

const { t } = useI18n();
const touched = ref(false);

const previewHref = computed(() => safeExternalUrl({ value: props.modelValue }));

const computedErrorMessage = computed(() => {
  if (props.errorMessage !== undefined) return props.errorMessage;
  if (!touched.value && !props.showError) return undefined;
  const err = validateOptionalExternalUrl({ value: props.modelValue });
  if (err === 'maxLength') return t('forms.validators.maxLength', { max: MAX_EXTERNAL_URL_LENGTH });
  if (err === 'httpUrl') return t('forms.validators.httpUrl');
  return undefined;
});

const onUpdateModelValue = (val: string | number | null) => {
  emit('update:modelValue', val == null ? '' : String(val));
};

const onBlur = () => {
  touched.value = true;
  emit('blur');
};
</script>

<template>
  <InputField
    :model-value="modelValue"
    type="url"
    :label="label"
    :placeholder="placeholder"
    :disabled="disabled"
    :autofocus="autofocus"
    :error-message="computedErrorMessage"
    @update:model-value="onUpdateModelValue"
    @blur="onBlur"
  >
    <template v-if="previewHref" #label-after>
      <DesktopOnlyTooltip :content="$t('common.transactions.record.externalLinkTooltip')">
        <a
          :href="previewHref"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="$t('common.transactions.record.externalLinkTooltip')"
          class="hover:text-foreground flex size-5 items-center justify-center"
        >
          <ExternalLinkIcon class="size-3.5" />
        </a>
      </DesktopOnlyTooltip>
    </template>
  </InputField>
</template>
