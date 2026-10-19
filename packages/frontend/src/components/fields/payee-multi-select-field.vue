<template>
  <MultiSelectField
    v-model:open="isOpen"
    v-model:search-term="searchTerm"
    :active="selectedCount > 0"
    :label="placeholder ?? $t('fields.payeeMultiSelect.label')"
    :selected-label="selectedLabel"
    :search-placeholder="$t('fields.payeeMultiSelect.searchPlaceholder')"
    :hide-clear-button="hideClearButton"
    :trigger-class="triggerClass"
    content-class="min-w-64"
    @clear="clearSelection"
  >
    <template v-if="singleSelectedPayee" #leading>
      <BrandLogo
        v-bind="toEntityLogoDisplayProps(singleSelectedPayee)"
        :name="singleSelectedPayee.name"
        class="size-4 shrink-0"
      />
    </template>

    <ScrollArea class="max-h-85 lg:max-h-60" viewport-class="max-h-85 lg:max-h-60">
      <div class="p-1.25">
        <template v-if="allowBlank && !debouncedQuery">
          <button
            type="button"
            class="hover:bg-accent hover:text-accent-foreground text-muted-foreground mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm"
            @click="toggleBlank"
          >
            <CircleDashedIcon class="size-4 shrink-0" />
            <span class="min-w-0 grow truncate">{{ $t('fields.payeeMultiSelect.blankOption') }}</span>
            <CheckIcon v-if="isBlankSelected" class="size-4 shrink-0" />
          </button>
          <div class="bg-border mb-1 h-px" />
        </template>
        <div v-if="isFetching && displayedPayees.length === 0" class="text-muted-foreground py-3 text-center text-xs">
          {{ $t('common.loading') }}
        </div>
        <p v-else-if="displayedPayees.length === 0" class="text-mauve8 py-2 text-center text-xs font-medium">
          {{ $t('fields.payeeMultiSelect.noResults') }}
        </p>
        <template v-else>
          <button
            v-for="payee in displayedPayees"
            :key="payee.id"
            type="button"
            class="hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm"
            @click="pickPayee(payee)"
          >
            <BrandLogo v-bind="toEntityLogoDisplayProps(payee)" :name="payee.name" class="size-4 shrink-0" />
            <span class="min-w-0 grow truncate">{{ payee.name }}</span>
            <CheckIcon v-if="isPayeeSelected(payee.id)" class="size-4 shrink-0" />
          </button>
        </template>
      </div>
    </ScrollArea>
  </MultiSelectField>
</template>

<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { pickLogoFields, toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import {
  type PayeeLookupEntry,
  type SelectedPayee,
  hydrateSelectedPayees,
} from '@/components/fields/payee-multi-select-field.helpers';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { usePayees, usePayeesByIds } from '@/composable/data-queries/payees';
import { BLANK_FILTER_VALUE, type EntityLogoFields, type RecordId } from '@bt/shared/types';
import { isEqual } from 'lodash-es';
import { CheckIcon, CircleDashedIcon } from '@lucide/vue';
import { useDebounce } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const DEBOUNCE_MS = 200;

const props = defineProps<{
  payeeIds: string[];
  /** Overrides the default trigger text shown while nothing is selected. */
  placeholder?: string;
  /** Hide the in-trigger clear button — for hosts (like the filter bar chips)
   * that render their own remove control next to the trigger. */
  hideClearButton?: boolean;
  /** Extra classes merged onto the trigger so a host can reshape it (e.g. the
   * Pivot Report renders it as a compact rounded filter pill). */
  triggerClass?: string;
  /** Offer a "Blank" pseudo-option (`BLANK_FILTER_VALUE`) matching transactions without a payee. */
  allowBlank?: boolean;
}>();

const emit = defineEmits<{
  'update:payeeIds': [value: string[]];
}>();

const isBlankSelected = computed(() => props.payeeIds.includes(BLANK_FILTER_VALUE));
const realPayeeIds = computed(() => props.payeeIds.filter((id) => id !== BLANK_FILTER_VALUE));

const { t } = useI18n();

const searchTerm = ref('');
const searchTermDebounced = useDebounce(searchTerm, DEBOUNCE_MS);
const debouncedQuery = computed(() => (searchTermDebounced.value ?? '').trim());
const isOpen = ref(false);

const {
  list: serverPayees,
  isFetching,
  isError: isSearchError,
} = usePayees({
  q: computed(() => (debouncedQuery.value.length > 0 ? debouncedQuery.value : undefined)),
  enabled: isOpen,
});

// The search list above is lazy (`enabled: isOpen`), so an externally-applied
// selection — e.g. restoring a saved Pivot view — has no name/logo source until the
// dropdown is first opened. Resolve those ids eagerly by id instead.
const { byId: resolvedSelectedById, isError: isByIdError } = usePayeesByIds({ ids: () => realPayeeIds.value });

// Surface a fetch failure instead of collapsing to the empty "no results" state (which reads as
// "you have no payees") or leaving a restored selection stuck on the unknown-payee placeholder.
const { addErrorNotification } = useNotificationCenter();
const hasLoadError = computed(() => isSearchError.value || isByIdError.value);
watch(hasLoadError, (isError) => {
  if (isError) addErrorNotification(t('fields.payeeMultiSelect.loadError'));
});

const selectedPayees = ref<SelectedPayee[]>([]);

watch(
  realPayeeIds,
  (newIds) => {
    if (isEqual([...newIds].sort(), selectedPayees.value.map((p) => p.id).sort())) return;
    const byId = new Map<string, SelectedPayee>([
      ...selectedPayees.value.map((p) => [p.id, p] as const),
      ...serverPayees.value.map((p) => [p.id, { id: p.id, name: p.name, ...pickLogoFields(p) }] as const),
    ]);
    selectedPayees.value = newIds.map(
      (id) =>
        byId.get(id) ?? {
          id: id as RecordId,
          name: t('fields.payeeMultiSelect.unknownPayee'),
          ...pickLogoFields({}),
        },
    );
  },
  { immediate: true },
);

const toLookup = (
  rows: readonly ({ id: string; name: string } & Partial<EntityLogoFields>)[],
): Map<string, PayeeLookupEntry> =>
  new Map(rows.map((p): [string, PayeeLookupEntry] => [p.id, { name: p.name, ...pickLogoFields(p) }]));

const hydrateFromLookup = (lookup: Map<string, PayeeLookupEntry>) => {
  if (selectedPayees.value.length === 0) return;
  selectedPayees.value = hydrateSelectedPayees({ selected: selectedPayees.value, lookup });
};

// Names/logos flow in from two independent sources: the search list while the
// dropdown is open, and the eager by-id resolver that backfills a restored selection.
watch(serverPayees, (rows) => hydrateFromLookup(toLookup(rows)));
watch(resolvedSelectedById, (map) => hydrateFromLookup(toLookup([...map.values()])), { immediate: true });

const selectedPayeeIds = computed(() => selectedPayees.value.map((p) => p.id));
const selectedCount = computed(() => selectedPayeeIds.value.length + (isBlankSelected.value ? 1 : 0));

const emitSelection = ({ blank }: { blank: boolean }) =>
  emit('update:payeeIds', blank ? [BLANK_FILTER_VALUE, ...selectedPayeeIds.value] : selectedPayeeIds.value);

const toggleBlank = () => emitSelection({ blank: !isBlankSelected.value });

// Trigger shows the brand logo only when exactly one payee is selected; a plain
// array-index guard doesn't narrow `[0]` away from `undefined`, so resolve the
// single row here.
const singleSelectedPayee = computed<SelectedPayee | null>(() =>
  selectedCount.value === 1 ? (selectedPayees.value[0] ?? null) : null,
);

// A single pick reads as the payee's own name (paired with its logo in the trigger's
// leading slot); any larger selection collapses to a plain "{n} payees selected".
const selectedLabel = computed(() => {
  if (singleSelectedPayee.value) return singleSelectedPayee.value.name;
  if (selectedCount.value === 1 && isBlankSelected.value) return t('fields.payeeMultiSelect.blankOption');
  return t('fields.payeeMultiSelect.selectedMany', { n: selectedCount.value });
});

const displayedPayees = computed<SelectedPayee[]>(() => {
  const selected = selectedPayees.value;
  const selectedIds = new Set(selected.map((p) => p.id));
  const rest = serverPayees.value
    .filter((p) => !selectedIds.has(p.id))
    .map<SelectedPayee>((p) => ({ id: p.id, name: p.name, ...pickLogoFields(p) }));
  return [...selected, ...rest];
});

const isPayeeSelected = (payeeId: RecordId) => selectedPayees.value.some((p) => p.id === payeeId);

const pickPayee = (payee: SelectedPayee) => {
  if (isPayeeSelected(payee.id)) {
    selectedPayees.value = selectedPayees.value.filter((p) => p.id !== payee.id);
  } else {
    selectedPayees.value = [...selectedPayees.value, { id: payee.id, name: payee.name, ...pickLogoFields(payee) }];
  }
  emitSelection({ blank: isBlankSelected.value });
};

const clearSelection = () => {
  selectedPayees.value = [];
  emit('update:payeeIds', []);
};
</script>
