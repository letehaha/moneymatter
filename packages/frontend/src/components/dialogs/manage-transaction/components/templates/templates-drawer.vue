<script lang="ts" setup>
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Drawer from '@/components/lib/ui/drawer';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { TransactionTemplateModel } from '@bt/shared/types';
import { ChevronDownIcon, ChevronUpIcon, LayoutTemplateIcon, XIcon } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';

import TemplatePreview from './template-preview.vue';
import TemplateRowContent from './template-row-content.vue';
import { type TemplateListEmits, type TemplateListProps, useTemplateList } from './use-template-list';

const FILTER_VISIBLE_FROM = 12;

const props = defineProps<TemplateListProps>();

const emit = defineEmits<TemplateListEmits>();

const { query, isOpen, filtered, amountLabelOf, staleReasonOf, footerActions, closeAnd, openEditor } = useTemplateList({
  props,
  emit,
});

const expandedId = ref<string | null>(null);
let appliedFromDrawer = false;

const isFilterVisible = computed(() => props.templates.length > FILTER_VISIBLE_FROM);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    query.value = '';
    expandedId.value = props.applied?.id ?? null;
  },
);

const rowEls = new Map<string, HTMLElement>();

const toggleRow = async ({ template }: { template: TransactionTemplateModel }) => {
  const expanding = expandedId.value !== template.id;
  expandedId.value = expanding ? template.id : null;
  if (!expanding) return;
  await nextTick();
  rowEls.get(template.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

const applyTemplate = ({ template }: { template: TransactionTemplateModel }) => {
  appliedFromDrawer = true;
  isOpen.value = false;
  emit('apply', template);
};

// Fires once the drawer is gone. Returning focus to the trigger here would undo the field
// focus the parent moves to after an apply.
const onCloseAutoFocus = (event: Event) => {
  if (!appliedFromDrawer) return;
  appliedFromDrawer = false;
  event.preventDefault();
  emit('closed-after-apply');
};
</script>

<template>
  <Drawer.Drawer v-model:open="isOpen">
    <div class="flex min-w-0 items-center gap-1">
      <Drawer.DrawerTrigger as-child>
        <Button
          variant="secondary"
          size="sm"
          :disabled="disabled"
          :class="
            cn(
              'min-w-0 gap-1.5 font-normal',
              applied && 'border-primary/60 bg-primary/20 text-primary-text hover:bg-primary/30 rounded-full border',
            )
          "
        >
          <LayoutTemplateIcon class="size-4 shrink-0" />
          <span class="truncate">
            {{ applied ? applied.name : $t('dialogs.manageTransaction.templates.trigger') }}
          </span>
          <ChevronUpIcon class="size-3.5 shrink-0" />
        </Button>
      </Drawer.DrawerTrigger>

      <Button
        v-if="applied"
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :aria-label="$t('dialogs.manageTransaction.templates.removeAriaLabel')"
        @click="emit('clear')"
      >
        <XIcon class="size-4" />
      </Button>
    </div>

    <Drawer.DrawerContent class="px-4 pb-4" @close-auto-focus="onCloseAutoFocus">
      <Drawer.DrawerTitle class="px-1 pt-4 text-base">
        {{ $t('dialogs.manageTransaction.templates.trigger') }}
      </Drawer.DrawerTitle>
      <p v-if="templates.length" class="text-muted-foreground px-1 pb-2 text-xs">
        {{ $t('dialogs.manageTransaction.templates.tapHint') }}
      </p>

      <div v-if="isLoading" aria-busy="true" class="flex flex-col gap-2 pb-3">
        <div v-for="index in 3" :key="index" class="bg-muted h-11 animate-pulse rounded-md" />
      </div>

      <div v-else-if="isError && !templates.length" class="flex flex-col items-start gap-2 px-1 pb-3">
        <p class="text-muted-foreground text-xs leading-relaxed">
          {{ $t('dialogs.manageTransaction.templates.loadError') }}
        </p>
        <Button variant="outline" size="sm" @click="emit('retry')">{{ $t('common.actions.retry') }}</Button>
      </div>

      <p v-else-if="!templates.length" class="text-muted-foreground px-1 pb-3 text-xs leading-relaxed">
        {{ $t('dialogs.manageTransaction.templates.emptyState') }}
      </p>

      <p v-else-if="!filtered.length" class="text-muted-foreground px-1 pb-3 text-xs leading-relaxed">
        {{ $t('dialogs.manageTransaction.templates.noMatches') }}
      </p>

      <ScrollArea v-else viewport-class="max-h-[55dvh]">
        <div class="flex flex-col">
          <div
            v-for="template in filtered"
            :key="template.id"
            :ref="(el) => (el ? rowEls.set(template.id, el as HTMLElement) : rowEls.delete(template.id))"
            class="border-border border-b last:border-b-0"
          >
            <div class="flex items-stretch">
              <Button
                variant="ghost"
                class="h-auto min-h-12 min-w-0 flex-1 justify-start rounded-none px-0 py-2 text-left font-normal"
                @click="applyTemplate({ template })"
              >
                <TemplateRowContent
                  :template="template"
                  :amount-label="amountLabelOf({ template })"
                  :stale-reason="staleReasonOf({ template })"
                />
              </Button>

              <Button
                variant="ghost"
                class="text-muted-foreground -mr-2 h-auto w-14 shrink-0 rounded-none px-0"
                :aria-expanded="expandedId === template.id"
                :aria-label="$t('dialogs.manageTransaction.templates.toggleDetails')"
                @click="toggleRow({ template })"
              >
                <ChevronDownIcon
                  :class="cn('size-4 transition-transform', expandedId === template.id && 'text-foreground rotate-180')"
                />
              </Button>
            </div>

            <TemplatePreview
              v-if="expandedId === template.id"
              :template="template"
              :sources="sources"
              :stale-reason="staleReasonOf({ template })"
              class="mb-2.5"
              @edit="openEditor({ template })"
            />
          </div>
        </div>
      </ScrollArea>

      <div v-if="isFilterVisible" class="mt-3">
        <InputField
          v-model="query"
          :placeholder="$t('dialogs.manageTransaction.templates.filterPlaceholder')"
          :aria-label="$t('dialogs.manageTransaction.templates.filterPlaceholder')"
        />
      </div>

      <div class="border-border mt-3 flex gap-1 border-t pt-3">
        <Button
          v-for="action in footerActions"
          :key="action.key"
          :variant="action.variant"
          size="lg"
          class="w-full justify-start px-4 font-normal"
          :disabled="action.disabled"
          @click="closeAnd({ run: action.run })"
        >
          <component :is="action.icon" v-if="action.icon" class="size-4" />
          {{ action.label }}
        </Button>
      </div>
    </Drawer.DrawerContent>
  </Drawer.Drawer>
</template>
