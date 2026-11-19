<template>
  <div class="min-w-0 @6xl/pivot-report:flex @6xl/pivot-report:items-center @6xl/pivot-report:gap-2">
    <!-- Wide: label + segmented pill tabs. Narrower: one cell of the host's joined strip, label inside the trigger. -->
    <span class="text-muted-foreground hidden text-xs font-medium @6xl/pivot-report:inline">{{ label }}</span>
    <div class="hidden @6xl/pivot-report:block">
      <PillTabs
        :model-value="modelValue"
        :items="items"
        size="sm"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
    <div class="@6xl/pivot-report:hidden">
      <Select.Select
        :model-value="modelValue"
        @update:model-value="(value) => emit('update:modelValue', value as string)"
      >
        <Select.SelectTrigger
          class="hover:bg-hover h-auto min-h-11 gap-1.5 rounded-none border-0 bg-transparent px-2.5 py-1 focus:ring-offset-0 focus:ring-inset @xl/pivot-report:min-h-8 @xl/pivot-report:px-3 @xl/pivot-report:py-0"
        >
          <span
            class="flex min-w-0 flex-col @xl/pivot-report:flex-row @xl/pivot-report:items-center @xl/pivot-report:gap-2"
          >
            <span class="text-muted-foreground text-[11px] leading-tight @xl/pivot-report:text-xs">{{ label }}</span>
            <span class="truncate font-medium"><Select.SelectValue /></span>
          </span>
        </Select.SelectTrigger>
        <Select.SelectContent>
          <Select.SelectItem v-for="item in items" :key="item.value" :value="item.value">
            {{ item.label }}
          </Select.SelectItem>
        </Select.SelectContent>
      </Select.Select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PillTabs, type PillTabItem } from '@/components/lib/ui/pill-tabs';
import * as Select from '@/components/lib/ui/select';

// Value is a plain string here; the host casts it back to its specific pivot union on update.
defineProps<{ label: string; items: PillTabItem[]; modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
