<template>
  <Popover v-model:open="isOpen">
    <!-- Trigger outside, tooltip inside: Tooltip spawns its own popper context,
         so a PopoverTrigger nested in it would anchor the popover content to the
         tooltip instead of the button. The span gives as-child a single element
         root to merge onto (the tooltip's root is a fragment). -->
    <PopoverTrigger as-child>
      <span class="inline-flex">
        <DesktopOnlyTooltip :content="$t(titleKey)">
          <Button size="icon-sm" variant="ghost" :aria-label="$t(titleKey)">
            <SettingsIcon class="text-muted-foreground size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </span>
    </PopoverTrigger>
    <PopoverContent class="w-72 overflow-hidden p-0" align="end">
      <SlidingPanels v-model="view" :panels="['main', 'columns']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ $t(titleKey) }}
            </header>

            <div class="flex flex-col p-2">
              <Button
                type="button"
                variant="ghost"
                class="h-auto w-full justify-between gap-2 px-2 py-2 text-left"
                @click="view = 'columns'"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ $t('transactions.table.columnConfig.columns') }}</span>
                  <span class="text-muted-foreground text-xs font-normal">
                    {{ $t('transactions.table.columnConfig.visibleCount', { count: visibleCount }) }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </Button>

              <slot name="settings" />

              <Button variant="outline" size="sm" class="mx-2 my-2" @click="emit('reset')">
                {{ $t('transactions.table.columnConfig.resetDefaults') }}
              </Button>
            </div>
          </div>
        </template>

        <template #columns>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <DesktopOnlyTooltip :content="$t('common.actions.back')">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  type="button"
                  :aria-label="$t('common.actions.back')"
                  @click="view = 'main'"
                >
                  <ArrowLeftIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
              <span class="text-sm font-medium">{{ $t('transactions.table.columnConfig.columns') }}</span>
            </header>

            <ScrollArea class="max-h-80" viewport-class="max-h-80">
              <VueDraggable
                v-model="draggableColumns"
                handle=".drag-handle"
                :animation="200"
                class="flex flex-col gap-0.5 p-2"
              >
                <div
                  v-for="item in draggableColumns"
                  :key="item.definition.id"
                  class="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <GripVerticalIcon class="drag-handle text-muted-foreground size-4 shrink-0 cursor-grab" />
                  <label class="flex flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                      :model-value="item.visible"
                      @update:model-value="() => emit('toggle', item.definition.id)"
                    />
                    <span class="text-sm">{{ $t(item.definition.labelKey) }}</span>
                  </label>
                </div>
              </VueDraggable>
            </ScrollArea>
          </div>
        </template>
      </SlidingPanels>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import SlidingPanels from '@/components/common/sliding-panels.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { ArrowLeftIcon, ChevronRightIcon, GripVerticalIcon, SettingsIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';

/**
 * Column id type: opaque string. Different tables use their own enums, but the
 * popover only forwards ids back through events – it never inspects them.
 */
interface ConfigurableColumnDefinition {
  id: string;
  labelKey: string;
}

const props = withDefaults(
  defineProps<{
    configurableColumns: { definition: ConfigurableColumnDefinition; visible: boolean }[];
    /** i18n key shown in the trigger tooltip, aria-label, and main-panel header. */
    titleKey?: string;
  }>(),
  { titleKey: 'transactions.table.columnConfig.title' },
);

const emit = defineEmits<{
  toggle: [id: string];
  reorder: [orderedIds: string[]];
  reset: [];
}>();

const isOpen = ref(false);
const view = ref<'main' | 'columns'>('main');

const POPOVER_CLOSE_ANIMATION_MS = 320;

// Reset to the main view after the popover finishes its close animation.
watch(isOpen, (open) => {
  if (!open) {
    setTimeout(() => {
      view.value = 'main';
    }, POPOVER_CLOSE_ANIMATION_MS);
  }
});

const visibleCount = computed(() => props.configurableColumns.filter((item) => item.visible).length);

// VueDraggable mutates its model on drop – keep a local copy and emit the new
// order upward instead of mutating the prop.
const draggableColumns = computed({
  get: () => props.configurableColumns,
  set: (next) => {
    emit(
      'reorder',
      next.map((item) => item.definition.id),
    );
  },
});
</script>
