<template>
  <div class="w-full">
    <FieldLabel :label="label" only-template>
      <template v-if="$slots['label-right']" #label-right>
        <slot name="label-right" />
      </template>
      <ListboxRoot ref="listboxRef" multiple :model-value="modelValue" highlight-on-hover>
        <Popover :open="isOpen" @update:open="(open: boolean) => (isOpen = open)">
          <PopoverAnchor as-child>
            <div
              ref="wrapperRef"
              :class="
                cn(
                  'border-input bg-input-background ring-offset-background flex min-h-10 w-full cursor-text items-center gap-2 rounded-md border px-3 py-2 text-sm md:min-h-9',
                  'focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-2',
                  disabled && 'cursor-not-allowed opacity-50',
                )
              "
              @click="focusInput"
              @keydown.enter.capture="onEnterCapture"
            >
              <div class="flex flex-1 flex-wrap items-center gap-1">
                <span
                  v-for="tag in selectedTags"
                  :key="tag.id"
                  class="group inline-flex cursor-pointer items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white transition-opacity hover:opacity-80"
                  :style="{ backgroundColor: tag.color }"
                  @click.stop="toggleTag(tag)"
                >
                  <XIcon class="absolute hidden size-3 group-hover:block" />
                  <span class="inline-flex items-center gap-1 group-hover:invisible">
                    <TagIcon v-if="tag.icon" :name="tag.icon" class="size-3" />
                    {{ tag.name }}
                  </span>
                </span>
                <!-- data-enter-picks marks Enter as taken by the tag pick, so enclosing Enter handlers skip it.
                     Enter is always prevented to block implicit submit of an enclosing form. -->
                <ListboxFilter
                  ref="inputRef"
                  v-model="searchQuery"
                  :disabled="disabled"
                  :placeholder="selectedTags.length ? '' : placeholder"
                  class="placeholder:text-muted-foreground min-w-16 flex-1 bg-transparent outline-none disabled:cursor-not-allowed"
                  :data-enter-picks="isPicking ? '' : undefined"
                  @focus="isOpen = true"
                  @keydown.up.down.home.end="hasNavigated = true"
                  @keydown.enter.prevent
                  @keydown.backspace="!searchQuery && selectedTags.at(-1) && toggleTag(selectedTags.at(-1)!)"
                />
              </div>
              <ChevronsUpDownIcon class="text-muted-foreground size-4 shrink-0" />
            </div>
          </PopoverAnchor>
          <PopoverContent
            class="w-(--reka-popover-trigger-width) p-4"
            align="start"
            @open-auto-focus.prevent
            @close-auto-focus.prevent
            @interact-outside="(e) => wrapperRef?.contains(e.target as Node) && e.preventDefault()"
          >
            <ListboxContent>
              <div v-if="filteredTags.length === 0" class="text-muted-foreground py-4 text-center text-sm">
                {{ $t('fields.tagSelect.noTagsAvailable') }}
              </div>
              <div v-else class="flex flex-wrap gap-2">
                <ListboxItem
                  v-for="tag in filteredTags"
                  :key="tag.id"
                  :value="tag.id"
                  as="span"
                  class="group responsive data-highlighted:ring-ring inline-flex cursor-pointer items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white transition-opacity data-highlighted:opacity-90 data-highlighted:ring-2 data-[state=checked]:opacity-50 data-[state=checked]:data-highlighted:opacity-100"
                  :style="{ backgroundColor: tag.color }"
                  @mousedown.prevent
                  @select="toggleTag(tag)"
                >
                  <template v-if="isSelected(tag.id)">
                    <XIcon class="absolute hidden size-3 group-hover:block" />
                    <span class="inline-flex items-center gap-1 group-hover:invisible">
                      <TagIcon v-if="tag.icon" :name="tag.icon" class="size-3" />
                      {{ tag.name }}
                    </span>
                  </template>
                  <template v-else>
                    <TagIcon v-if="tag.icon" :name="tag.icon" class="size-3" />
                    {{ tag.name }}
                  </template>
                </ListboxItem>
              </div>
            </ListboxContent>
          </PopoverContent>
        </Popover>
      </ListboxRoot>
    </FieldLabel>
    <FieldError :error-message="errorMessage" />
  </div>
</template>

<script setup lang="ts">
import TagIcon from '@/components/common/icons/tag-icon.vue';
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { Popover, PopoverContent } from '@/components/lib/ui/popover';
import { cn } from '@/lib/utils';
import { useTagsStore } from '@/stores';
import { TagModel } from '@bt/shared/types';
import { ChevronsUpDownIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { ListboxContent, ListboxFilter, ListboxItem, ListboxRoot, PopoverAnchor } from 'reka-ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue?: string[];
    placeholder?: string;
    errorMessage?: string;
    disabled?: boolean;
  }>(),
  {
    label: undefined,
    modelValue: () => [],
    placeholder: undefined,
    errorMessage: undefined,
  },
);

const emit = defineEmits<{
  'update:model-value': [value: string[]];
}>();

const { t } = useI18n();
const tagsStore = useTagsStore();
const { tags } = storeToRefs(tagsStore);

const isOpen = ref(false);
const wrapperRef = ref<HTMLDivElement>();
const inputRef = ref<{ $el: HTMLInputElement } | null>(null);
const focusInput = () => inputRef.value?.$el.focus();

const searchQuery = ref('');
watch(isOpen, () => (searchQuery.value = ''));

const query = computed(() => searchQuery.value.trim().toLowerCase());

const filteredTags = computed(() =>
  query.value ? tags.value.filter((tag) => tag.name.toLowerCase().includes(query.value)) : tags.value,
);

const hasNavigated = ref(false);
watch([isOpen, searchQuery], () => (hasNavigated.value = false));
const isPicking = computed(
  () => isOpen.value && filteredTags.value.length > 0 && (Boolean(query.value) || hasNavigated.value),
);

// Enter picks only after typing or arrowing. Otherwise drop the highlight (left by hover or a tag
// removal) so reka ignores the key and it reaches enclosing handlers, e.g. Cmd+Enter submit.
const listboxRef = ref<{ highlightedElement: HTMLElement | null } | null>(null);
const onEnterCapture = (event: KeyboardEvent) => {
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  if (isPicking.value && !hasModifier) return;
  if (listboxRef.value) listboxRef.value.highlightedElement = null;
};

const selectedTagIds = computed(() => new Set(props.modelValue ?? []));

const selectedTags = computed(() => {
  const ids = props.modelValue ?? [];
  return ids.map((id) => tags.value.find((tag) => tag.id === id)).filter((tag): tag is TagModel => tag !== undefined);
});

const placeholder = computed(() => props.placeholder ?? t('fields.tagSelect.placeholder'));

// Focusing the input is what opens the list.
defineExpose({ open: focusInput });

const isSelected = (tagId: string) => selectedTagIds.value.has(tagId);

const toggleTag = (tag: TagModel) => {
  const currentIds = [...(props.modelValue ?? [])];
  const index = currentIds.indexOf(tag.id);

  if (index === -1) {
    currentIds.push(tag.id);
  } else {
    currentIds.splice(index, 1);
  }

  emit('update:model-value', currentIds);
  searchQuery.value = '';
  hasNavigated.value = false;
  focusInput();
};
</script>
