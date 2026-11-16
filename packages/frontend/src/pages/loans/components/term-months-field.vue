<template>
  <InputField
    :model-value="modelValue"
    type="number"
    :label="label"
    :placeholder="placeholder"
    :disabled="disabled"
    :error-message="errorMessage"
    @update:model-value="(value) => emit('update:modelValue', value === '' ? null : Number(value))"
    @blur="emit('blur')"
  >
    <template #iconTrailing>
      <Popover.Popover>
        <Popover.PopoverTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            :disabled="disabled"
            :aria-label="$t('forms.loan.termPresetsAriaLabel')"
            class="text-muted-foreground hover:text-foreground -mr-2 size-6"
          >
            <ChevronDownIcon class="size-4" />
          </Button>
        </Popover.PopoverTrigger>
        <Popover.PopoverContent align="end" class="w-48 p-1">
          <div class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
            {{ $t('forms.loan.termPresetsHeader') }}
          </div>
          <Button
            v-for="preset in presets"
            :key="preset.months"
            type="button"
            variant="ghost"
            size="sm"
            class="flex w-full items-center justify-between px-2 font-normal"
            :class="modelValue === preset.months && 'bg-accent hover:bg-accent'"
            @click="selectPreset(preset.months)"
          >
            <span>{{ preset.label }}</span>
            <span class="text-muted-foreground text-xs"
              >{{ preset.months }}{{ $t('forms.loan.termMonthsSuffix') }}</span
            >
          </Button>
        </Popover.PopoverContent>
      </Popover.Popover>
    </template>
  </InputField>
</template>

<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { ChevronDownIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  modelValue: number | null;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number | null];
  blur: [];
}>();

const { t } = useI18n();

// Year-aligned terms are what users actually quote ("a 30-year mortgage"); the months value beside
// each one is a sanity-check.
const PRESET_YEARS = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30];

const presets = computed(() =>
  PRESET_YEARS.map((years) => ({
    months: years * 12,
    label: t('forms.loan.termPresetYears', { count: years }),
  })),
);

const selectPreset = (months: number) => {
  emit('update:modelValue', months);
};
</script>
