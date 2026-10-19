<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex flex-col gap-2">
      <input
        ref="searchInputRef"
        v-model="search"
        type="text"
        :placeholder="$t('common.iconPicker.searchPlaceholder')"
        class="border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
        @input="resetScroll"
      />

      <div ref="scrollContainerRef" class="max-h-60 overflow-y-auto rounded-md border">
        <div :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }">
          <div
            v-for="row in virtualRows"
            :key="row.index"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${row.size}px`,
              transform: `translateY(${row.start}px)`,
            }"
          >
            <div class="grid grid-cols-7 gap-1 p-1">
              <template v-for="iconName in getIconsForRow(row.index)" :key="iconName" :delay-duration="0">
                <Button size="icon" variant="ghost" :title="iconName" @click="selectIcon(iconName)">
                  <Icon :icon="`fluent:${iconName}`" class="size-8" />
                </Button>
              </template>
            </div>
          </div>
        </div>
      </div>

      <Button v-if="modelValue" variant="ghost-destructive" size="sm" @click="clearIcon">
        {{ $t('common.iconPicker.clear') }}
      </Button>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import Button from '@/components/lib/ui/button/Button.vue';
import { TooltipProvider } from '@/components/lib/ui/tooltip';
import fluentFilledIcons from '@/data/fluent-filled-icons.json';
import { Icon } from '@iconify/vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { computed, onMounted, ref } from 'vue';

const ICONS_PER_ROW = 7;
const ROW_HEIGHT = 48;

defineProps<{
  modelValue?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  close: [];
}>();

const search = ref('');
const scrollContainerRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const filteredIcons = computed(() => {
  if (!search.value.trim()) return fluentFilledIcons;
  const searchLower = search.value.toLowerCase().trim();
  return fluentFilledIcons.filter((name: string) => name.includes(searchLower));
});

const rowCount = computed(() => Math.ceil(filteredIcons.value.length / ICONS_PER_ROW));

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rowCount.value,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

const getIconsForRow = (rowIndex: number): string[] => {
  const start = rowIndex * ICONS_PER_ROW;
  const end = Math.min(start + ICONS_PER_ROW, filteredIcons.value.length);
  return filteredIcons.value.slice(start, end);
};

const resetScroll = () => {
  virtualizer.value.scrollToIndex(0);
};

const selectIcon = (iconName: string) => {
  emit('update:modelValue', iconName);
  emit('close');
};

const clearIcon = () => {
  emit('update:modelValue', '');
  emit('close');
};

onMounted(() => {
  searchInputRef.value?.focus();
});
</script>
