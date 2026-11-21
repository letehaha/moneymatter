<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  fileFields: string[];
  requiredFields: string[];
}>();

const emit = defineEmits<{
  mappingComplete: [mapping: Record<string, string>, dateFormat: string];
  mappingChanged: [mapping: Record<string, string>, dateFormat: string];
}>();

// Map of required field -> selected file field
const fieldMapping = ref<Record<string, string>>({});

// Date format selection
const dateFormat = ref<string>('dd/MM/yyyy');

// Auto-detect common field names
function autoDetectFields() {
  const mapping: Record<string, string> = {};

  for (const required of props.requiredFields) {
    const lowerRequired = required.toLowerCase();
    const match = props.fileFields.find((field) => {
      const lowerField = field.toLowerCase();
      return (
        lowerField === lowerRequired ||
        lowerField.includes(lowerRequired) ||
        (lowerRequired === 'price' && (lowerField.includes('value') || lowerField.includes('amount')))
      );
    });

    if (match) {
      mapping[required] = match;
    }
  }

  fieldMapping.value = mapping;
}

// Check if mapping is complete
const isMappingComplete = computed(() => {
  return props.requiredFields.every((field) => fieldMapping.value[field]);
});

watch(
  () => props.fileFields,
  () => {
    autoDetectFields();
  },
  { immediate: true },
);

watch(
  [fieldMapping, dateFormat],
  ([mapping, format]) => {
    emit('mappingChanged', mapping, format);
    if (isMappingComplete.value) {
      emit('mappingComplete', mapping, format);
    }
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <div class="space-y-3">
    <h3 class="text-sm font-medium">{{ $t('settings.admin.priceUpload.fieldMapper.title') }}</h3>
    <p class="text-muted-foreground text-xs">{{ $t('settings.admin.priceUpload.fieldMapper.description') }}</p>

    <div class="space-y-2">
      <div
        v-for="required in requiredFields"
        :key="required"
        class="border-border flex items-center gap-3 rounded border p-3"
      >
        <div class="min-w-25 font-medium">
          {{ required }}
          <span class="text-destructive-text">*</span>
        </div>
        <div class="text-muted-foreground mx-2">→</div>
        <select
          v-model="fieldMapping[required]"
          class="border-input bg-input-background h-10 flex-1 rounded border px-3 py-2 text-sm"
        >
          <option value="">{{ $t('settings.admin.priceUpload.fieldMapper.selectField') }}</option>
          <option v-for="field in fileFields" :key="field" :value="field">
            {{ field }}
          </option>
        </select>
      </div>
    </div>

    <!-- Date Format Selection -->
    <div class="border-border space-y-2 rounded border p-3">
      <label class="text-sm font-medium">
        {{ $t('settings.admin.priceUpload.fieldMapper.dateFormatLabel') }} <span class="text-destructive-text">*</span>
      </label>
      <p class="text-muted-foreground text-xs">
        {{ $t('settings.admin.priceUpload.fieldMapper.dateFormatDescription') }}
      </p>
      <select
        v-model="dateFormat"
        class="border-input bg-input-background h-10 w-full rounded border px-3 py-2 text-sm"
      >
        <option value="dd/MM/yyyy">{{ $t('settings.admin.priceUpload.fieldMapper.dateFormats.ddMMyyyySlash') }}</option>
        <option value="MM/dd/yyyy">{{ $t('settings.admin.priceUpload.fieldMapper.dateFormats.MMddyyyySlash') }}</option>
        <option value="yyyy-MM-dd">{{ $t('settings.admin.priceUpload.fieldMapper.dateFormats.yyyyMMddDash') }}</option>
        <option value="dd-MM-yyyy">{{ $t('settings.admin.priceUpload.fieldMapper.dateFormats.ddMMyyyyDash') }}</option>
        <option value="MM-dd-yyyy">{{ $t('settings.admin.priceUpload.fieldMapper.dateFormats.MMddyyyyDash') }}</option>
      </select>
    </div>

    <Callout v-if="isMappingComplete" variant="success">
      {{ $t('settings.admin.priceUpload.fieldMapper.mappingComplete') }}
    </Callout>
    <div v-else class="text-muted-foreground flex items-center gap-2 text-xs">
      {{ $t('settings.admin.priceUpload.fieldMapper.mappingIncomplete') }}
    </div>
  </div>
</template>
