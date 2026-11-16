<template>
  <Combobox.Combobox
    :model-value="undefined"
    v-model:searchTerm="searchTerm"
    v-model:open="isOpen"
    :multiple="true"
    class="w-full"
  >
    <Combobox.ComboboxAnchor>
      <Combobox.ComboboxTrigger
        :class="
          cn(
            'border-input bg-input-background ring-offset-background focus-visible:ring-ring flex w-full items-center justify-between rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            controlHeight[size],
          )
        "
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <span
            class="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border px-2 text-sm font-medium"
          >
            {{ isAllSelected ? tagsCount : selectedTagIds.length }}
          </span>
          <span class="min-w-0 flex-1 truncate text-left font-medium">
            {{ triggerLabel }}
          </span>
        </div>

        <template v-if="!isAllSelected && selectedTagIds.length > 0 && !hideClearButton">
          <Button variant="ghost" size="icon" class="size-6 shrink-0" @click.stop="clearSelection">
            <XIcon class="text-muted-foreground size-4" />
          </Button>
        </template>
        <template v-else>
          <div class="size-6 shrink-0 p-1">
            <ChevronDown class="text-muted-foreground size-4" />
          </div>
        </template>
      </Combobox.ComboboxTrigger>
    </Combobox.ComboboxAnchor>

    <Combobox.ComboboxList class="max-h-100 w-(--reka-combobox-trigger-width) lg:max-h-75">
      <div class="relative w-full items-center p-2 pb-0">
        <Combobox.ComboboxInput
          class="border-input bg-input-background dark:border-border h-9 w-full rounded-md border pl-9 focus-visible:ring-0 dark:bg-transparent"
          :placeholder="$t('transactions.filters.tags.searchPlaceholder')"
        />
        <SearchIcon class="text-muted-foreground absolute top-[60%] left-4 size-5 -translate-y-1/2" />
      </div>
      <div class="max-h-85 overflow-y-auto p-1.25 lg:max-h-60">
        <Combobox.ComboboxEmpty class="text-mauve8 py-2 text-center text-xs font-medium" />

        <Combobox.ComboboxGroup>
          <template v-if="allowBlank && !searchTerm.trim()">
            <Combobox.ComboboxItem
              :value="BLANK_FILTER_VALUE"
              class="hover:bg-hover hover:text-accent-foreground text-muted-foreground flex-start mb-1 flex cursor-pointer items-center justify-between rounded-md px-2 py-1"
              @select.prevent="toggleTagId(BLANK_FILTER_VALUE)"
            >
              <div class="flex items-center gap-2">
                <CircleDashedIcon class="size-4 shrink-0" />
                <span class="truncate">{{ $t('transactions.filters.tags.blankOption') }}</span>
              </div>
              <CheckIcon v-if="isTagSelected(BLANK_FILTER_VALUE)" />
            </Combobox.ComboboxItem>
            <div class="bg-border mb-1 h-px" />
          </template>
          <Combobox.ComboboxItem
            v-for="tag in displayedTags"
            :key="tag.id"
            :value="tag"
            class="hover:bg-hover hover:text-accent-foreground flex-start flex cursor-pointer items-center justify-between rounded-md px-2 py-1"
            @select.prevent="toggleTagId(tag.id)"
          >
            <div class="flex items-center gap-2">
              <div class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }" />
              <TagIcon v-if="tag.icon" :name="tag.icon" class="text-muted-foreground size-4 shrink-0" />
              <span class="truncate">{{ tag.name }}</span>
            </div>
            <CheckIcon v-if="isTagSelected(tag.id)" />
          </Combobox.ComboboxItem>
        </Combobox.ComboboxGroup>
      </div>
    </Combobox.ComboboxList>
  </Combobox.Combobox>
</template>

<script setup lang="ts">
import TagIcon from '@/components/common/icons/tag-icon.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import * as Combobox from '@/components/lib/ui/combobox';
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import { cn } from '@/lib/utils';
import { useTagsStore } from '@/stores';
import { BLANK_FILTER_VALUE, type RecordId } from '@bt/shared/types';
import { isEqual } from 'lodash-es';
import { CheckIcon, ChevronDown, CircleDashedIcon, SearchIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { computed, ref, watch } from 'vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    tagIds: string[];
    /** Hide the in-trigger clear button — for hosts (like the filter bar chips)
     * that render their own remove control next to the trigger. */
    hideClearButton?: boolean;
    /** Offer a "Blank" pseudo-option (`BLANK_FILTER_VALUE`) matching untagged transactions. */
    allowBlank?: boolean;
    size?: ControlSize;
  }>(),
  { size: 'default' },
);

const emit = defineEmits<{
  'update:tagIds': [value: string[]];
}>();

const searchTerm = ref('');
const isOpen = ref(false);

const { tags } = storeToRefs(useTagsStore());

const tagsCount = computed(() => tags.value.length);

const selectedTagIds = ref<string[]>([]);

// Sync internal state when props change (and differ from current state)
watch(
  () => props.tagIds,
  (newIds) => {
    // Only sync if values actually differ (prevents loops)
    if (isEqual([...newIds].sort(), [...selectedTagIds.value].sort())) return;

    selectedTagIds.value = [...newIds];
  },
  { immediate: true },
);

const isAllSelected = computed(() => selectedTagIds.value.length === 0);

const triggerLabel = computed(() => {
  if (isAllSelected.value) return t('transactions.filters.tags.allTags');
  if (selectedTagIds.value.length === 1 && selectedTagIds.value[0] === BLANK_FILTER_VALUE) {
    return t('transactions.filters.tags.blankOption');
  }
  const noun =
    selectedTagIds.value.length === 1
      ? t('transactions.filters.tags.tagSingular')
      : t('transactions.filters.tags.tagPlural');
  return `${noun} ${t('transactions.filters.tags.selected')}`;
});

const baseSortedTags = computed(() => {
  return [...tags.value].sort((a, b) => a.name.localeCompare(b.name));
});

const sessionOrder = ref<string[]>([]);

watch(isOpen, (open) => {
  if (open) {
    const selectedIds = new Set(selectedTagIds.value);
    const selectedFirst = baseSortedTags.value.filter((tag) => selectedIds.has(tag.id));
    const others = baseSortedTags.value.filter((tag) => !selectedIds.has(tag.id));
    sessionOrder.value = [...selectedFirst, ...others].map((tag) => tag.id);
  }
});

const orderedTags = computed(() => {
  if (isOpen.value && sessionOrder.value.length) {
    const byId = new Map(baseSortedTags.value.map((tag) => [tag.id, tag] as const));
    return sessionOrder.value.map((id) => byId.get(id as RecordId)!).filter(Boolean);
  }
  return baseSortedTags.value;
});

const displayedTags = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  if (!term) return orderedTags.value;
  return orderedTags.value.filter((tag) => tag.name.toLowerCase().includes(term));
});

const isTagSelected = (tagId: string) => selectedTagIds.value.includes(tagId);

const toggleTagId = (tagId: string) => {
  selectedTagIds.value = isTagSelected(tagId)
    ? selectedTagIds.value.filter((id) => id !== tagId)
    : tagId === BLANK_FILTER_VALUE
      ? [BLANK_FILTER_VALUE, ...selectedTagIds.value]
      : [...selectedTagIds.value, tagId];
  emit('update:tagIds', selectedTagIds.value);
};

const clearSelection = () => {
  selectedTagIds.value = [];
  emit('update:tagIds', []);
};
</script>
