<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import type { TransactionTemplateModel } from '@bt/shared/types';
import { ChevronDownIcon, LayoutTemplateIcon, XIcon } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';

import TemplatePreview from './template-preview.vue';
import TemplateRowContent from './template-row-content.vue';
import { type TemplateListEmits, type TemplateListProps, useTemplateList } from './use-template-list';

const props = defineProps<TemplateListProps>();

const emit = defineEmits<TemplateListEmits>();

const { query, isOpen, filtered, amountLabelOf, staleReasonOf, footerActions, closeAnd, openEditor } = useTemplateList({
  props,
  emit,
});

const highlightedId = ref<string | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);

// The popover restores focus to its trigger on close, which would undo the field focus
// the parent moves to after an apply.
let restoreFocusOnClose = true;

const highlighted = computed(() => filtered.value.find((template) => template.id === highlightedId.value) ?? null);

const optionDomId = ({ id }: { id: string }) => `transaction-template-option-${id}`;

const scrollHighlightIntoView = () => {
  if (!highlightedId.value) return;
  nextTick(() => {
    document.getElementById(optionDomId({ id: highlightedId.value! }))?.scrollIntoView({ block: 'nearest' });
  });
};

const setHighlight = ({ id }: { id: string | null }) => {
  highlightedId.value = id;
  scrollHighlightIntoView();
};

watch(filtered, (list) => {
  if (list.some((template) => template.id === highlightedId.value)) return;
  highlightedId.value = list[0]?.id ?? null;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    restoreFocusOnClose = true;
    query.value = '';
    highlightedId.value = props.applied?.id ?? props.templates[0]?.id ?? null;
  },
);

watch(
  () => props.open && !props.isLoading,
  (ready) => {
    if (ready) nextTick(() => filterInputRef.value?.focus());
  },
);

const moveHighlight = ({ step }: { step: number }) => {
  const list = filtered.value;
  if (!list.length) return;
  const current = list.findIndex((template) => template.id === highlightedId.value);
  const next = Math.min(Math.max(current + step, 0), list.length - 1);
  setHighlight({ id: list[next]!.id });
};

const applyTemplate = ({ template }: { template: TransactionTemplateModel }) => {
  restoreFocusOnClose = false;
  isOpen.value = false;
  emit('apply', template);
};

const onCloseAutoFocus = (event: Event) => {
  if (restoreFocusOnClose) return;
  restoreFocusOnClose = true;
  event.preventDefault();
  emit('closed-after-apply');
};

const onFilterKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown') moveHighlight({ step: 1 });
  else if (event.key === 'ArrowUp') moveHighlight({ step: -1 });
  else if (event.key === 'Home') setHighlight({ id: filtered.value[0]?.id ?? null });
  else if (event.key === 'End') setHighlight({ id: filtered.value[filtered.value.length - 1]?.id ?? null });
  else if (event.key === 'Enter') {
    if (highlighted.value) applyTemplate({ template: highlighted.value });
  } else return;

  event.preventDefault();
};
</script>

<template>
  <div class="flex items-center gap-1">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <Button
          variant="secondary"
          size="sm"
          :disabled="disabled"
          @pointerenter="emit('prefetch')"
          @focus="emit('prefetch')"
          :class="
            cn(
              'gap-1.5 font-normal',
              applied && 'border-primary/60 bg-primary/20 text-primary-text hover:bg-primary/30 rounded-full border',
            )
          "
        >
          <LayoutTemplateIcon class="size-4" />
          <span class="max-w-40 truncate">
            {{ applied ? applied.name : $t('dialogs.manageTransaction.templates.trigger') }}
          </span>
          <ChevronDownIcon class="size-3.5" />
        </Button>
      </Popover.PopoverTrigger>

      <Popover.PopoverContent
        align="start"
        :class="cn('p-0', templates.length || isLoading ? 'flex min-h-95 w-142.5 flex-col' : 'w-96')"
        @close-auto-focus="onCloseAutoFocus"
        @open-auto-focus.prevent
      >
        <div v-if="isLoading" aria-busy="true" class="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)]">
          <div class="border-border flex flex-col gap-2 border-r p-3">
            <div v-for="index in 4" :key="index" class="bg-muted h-6 animate-pulse rounded" />
          </div>
          <div class="flex flex-col gap-2 p-4">
            <div class="bg-muted h-5 w-1/2 animate-pulse rounded" />
            <div class="bg-muted h-4 w-1/3 animate-pulse rounded" />
            <div class="bg-muted mt-2 h-4 w-3/4 animate-pulse rounded" />
            <div class="bg-muted h-4 w-2/3 animate-pulse rounded" />
          </div>
        </div>

        <template v-else-if="templates.length">
          <div class="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)]">
            <div class="border-border flex min-h-0 flex-col border-r">
              <!-- Raw input: InputField wraps the control in two elements, which breaks this
                   column's flush bottom border. -->
              <input
                ref="filterInputRef"
                v-model="query"
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls="transaction-templates-listbox"
                :aria-activedescendant="highlightedId ? optionDomId({ id: highlightedId }) : undefined"
                class="border-border w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
                :placeholder="$t('dialogs.manageTransaction.templates.filterPlaceholder')"
                :aria-label="$t('dialogs.manageTransaction.templates.filterPlaceholder')"
                @keydown="onFilterKeydown"
              />

              <ScrollArea class="max-h-72 min-h-0">
                <div id="transaction-templates-listbox" role="listbox" class="py-1">
                  <Button
                    v-for="template in filtered"
                    :id="optionDomId({ id: template.id })"
                    :key="template.id"
                    variant="ghost"
                    role="option"
                    tabindex="-1"
                    :aria-selected="template.id === highlightedId"
                    :class="
                      cn(
                        'h-auto w-full justify-start rounded-none px-3 py-1.5 text-left font-normal',
                        template.id === highlightedId && 'bg-primary/15 hover:bg-primary/15',
                      )
                    "
                    @mousemove="setHighlight({ id: template.id })"
                    @click="applyTemplate({ template })"
                  >
                    <TemplateRowContent
                      :template="template"
                      :amount-label="amountLabelOf({ template })"
                      :stale-reason="staleReasonOf({ template })"
                    />
                  </Button>
                </div>
              </ScrollArea>
            </div>

            <TemplatePreview
              v-if="highlighted"
              :template="highlighted"
              :sources="sources"
              :stale-reason="staleReasonOf({ template: highlighted })"
              @edit="openEditor({ template: highlighted })"
            />
            <div v-else class="text-muted-foreground p-4 text-sm">
              {{ $t('dialogs.manageTransaction.templates.noMatches') }}
            </div>
          </div>
        </template>

        <div v-else-if="isError" class="flex flex-col items-start gap-2 px-3 pt-3">
          <p class="text-muted-foreground text-xs leading-relaxed">
            {{ $t('dialogs.manageTransaction.templates.loadError') }}
          </p>
          <Button variant="outline" size="sm" @click="emit('retry')">{{ $t('common.actions.retry') }}</Button>
        </div>

        <p v-else class="text-muted-foreground mb-4 px-3 pt-3 text-xs leading-relaxed">
          {{ $t('dialogs.manageTransaction.templates.emptyState') }}
        </p>

        <div class="border-border flex flex-wrap items-center gap-1 border-t p-2">
          <Button
            v-for="action in footerActions"
            :key="action.key"
            :variant="action.variant"
            size="sm"
            :class="cn('font-normal', action.key === 'new' && 'ml-auto')"
            :disabled="action.disabled"
            @click="closeAnd({ run: action.run })"
          >
            <component :is="action.icon" v-if="action.icon" class="size-4" />
            {{ action.label }}
          </Button>
        </div>
      </Popover.PopoverContent>
    </Popover.Popover>

    <DesktopOnlyTooltip v-if="applied" :content="$t('dialogs.manageTransaction.templates.removeAriaLabel')">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="$t('dialogs.manageTransaction.templates.removeAriaLabel')"
        @click="emit('clear')"
      >
        <XIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>
  </div>
</template>
