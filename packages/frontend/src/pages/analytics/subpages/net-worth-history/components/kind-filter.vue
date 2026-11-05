<template>
  <div v-if="kinds.length > 0" class="w-[190px] max-w-full">
    <MultiSelectField
      v-model:open="isOpen"
      :active="isNarrowed"
      :label="$t(allKey)"
      :selected-label="selectedLabel"
      :searchable="false"
      :selected="includedKindList"
      content-class="w-64"
      @clear="clearSelection"
    >
      <div class="border-border/60 text-muted-foreground border-b px-3 py-2 text-xs">
        {{ $t(scopeHintKey) }}
      </div>

      <ListboxContent class="p-2">
        <MultiSelectItem
          v-for="kind in kinds"
          :key="kind"
          :value="kind"
          class="data-[state=checked]:bg-primary/5 gap-2.5 px-2 py-1.5"
          @toggle="toggleKind(kind)"
        >
          <Checkbox :model-value="isChecked(kind)" class="pointer-events-none" tabindex="-1" />
          <span v-if="colors" class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: colors[kind] }" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ $t(labelKeys[kind]) }}</span>
        </MultiSelectItem>
      </ListboxContent>
    </MultiSelectField>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import MultiSelectItem from '@/components/fields/multi-select-item.vue';
import { ListboxContent } from 'reka-ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { resolveSelectedKinds } from '../composables/net-worth-history-derivations';

/**
 * Generic kind filter for the Net Worth History report, shared by the asset-kind
 * and liability-kind filters. Purely client-side: toggling kinds reshapes the
 * already-loaded series, it never refetches.
 *
 * `modelValue` is the set of INCLUDED kinds. An EMPTY array is the load-bearing
 * "all kinds" default. Only kinds with activity in the loaded series are offered
 * (`kinds`), so the filter disappears entirely for ranges with none.
 */
const props = withDefaults(
  defineProps<{
    modelValue?: T[];
    // Kinds with a nonzero balance anywhere in the loaded series, in display order.
    kinds: T[];
    // i18n label key per kind, for the row label.
    labelKeys: Record<T, string>;
    // i18n namespace for the shell strings; keys read `${i18nPrefix}.all`,
    // `.scopeHint`, `.selectedOne`, `.selectedMany`.
    i18nPrefix: string;
    // Optional per-kind swatch color; the swatch renders only when this is provided.
    colors?: Partial<Record<T, string>>;
  }>(),
  {
    modelValue: () => [],
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: T[]];
}>();

const { t } = useI18n();

const isOpen = ref(false);

const allKey = computed(() => `${props.i18nPrefix}.all`);
const scopeHintKey = computed(() => `${props.i18nPrefix}.scopeHint`);

// Shares resolveSelectedKinds with the chart so the filter's checked state
// always matches what actually renders.
const includedKinds = computed<Set<T>>(
  () => new Set(resolveSelectedKinds({ stored: props.modelValue ?? [], available: props.kinds })),
);

const includedKindList = computed(() => [...includedKinds.value]);
const selectedCount = computed(() => includedKinds.value.size);

// Narrowed only when a strict subset is included; "all included" and "none stored"
// both read as the wide-open default.
const isNarrowed = computed(() => selectedCount.value > 0 && selectedCount.value < props.kinds.length);

const isChecked = (kind: T) => includedKinds.value.has(kind);

const selectedLabel = computed(() =>
  selectedCount.value === 1
    ? t(`${props.i18nPrefix}.selectedOne`)
    : t(`${props.i18nPrefix}.selectedMany`, { n: selectedCount.value }),
);

const toggleKind = (kind: T) => {
  const next = new Set(includedKinds.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);

  // Collapse "everything included" and "nothing left" back to the empty "all"
  // sentinel — there is no distinct "no kinds" state, empty always means all.
  if (next.size === 0 || next.size === props.kinds.length) {
    emit('update:modelValue', []);
    return;
  }

  emit('update:modelValue', [...next]);
};

const clearSelection = () => emit('update:modelValue', []);
</script>
