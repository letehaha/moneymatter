<template>
  <div class="max-w-72 space-y-3">
    <p class="text-muted-foreground text-xs">{{ $t('analytics.cashFlow.composition.levelsHint') }}</p>
    <div class="flex items-center justify-between gap-6">
      <Label class="text-app-income-color">{{ $t('analytics.cashFlow.composition.sources') }}</Label>
      <PillTabs
        size="sm"
        :items="sourceLevelItems"
        :model-value="String(sourceLevel)"
        @update:model-value="sourceLevel = Number($event)"
      />
    </div>
    <div class="flex items-center justify-between gap-6">
      <Label class="text-app-expense-color">{{ $t('analytics.cashFlow.expenses') }}</Label>
      <PillTabs
        size="sm"
        :items="expenseLevelItems"
        :model-value="String(expenseLevel)"
        @update:model-value="expenseLevel = Number($event)"
      />
    </div>
    <Select v-if="showTopN" v-model="topN">
      <SelectTrigger size="xs" class="w-full gap-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in TOP_N_OPTIONS" :key="option" :value="option">
          {{ $t('analytics.cashFlow.composition.topN', { count: option }) }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>

<script lang="ts">
export const TOP_N_OPTIONS = ['5', '8', '12', '20'];
</script>

<script setup lang="ts">
import Label from '@/components/lib/ui/label/Label.vue';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/lib/ui/select';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const SOURCE_LEVELS = [1, 2, 3];
const EXPENSE_LEVELS = [1, 2];

defineProps<{ showTopN?: boolean }>();
const sourceLevel = defineModel<number>('sourceLevel', { required: true });
const expenseLevel = defineModel<number>('expenseLevel', { required: true });
const topN = defineModel<string>('topN');

const { t } = useI18n();
const levelItems = (levels: number[]) =>
  levels.map((level) => ({ value: String(level), label: t('analytics.cashFlow.composition.level', { level }) }));
const sourceLevelItems = computed(() => levelItems(SOURCE_LEVELS));
const expenseLevelItems = computed(() => levelItems(EXPENSE_LEVELS));
</script>
