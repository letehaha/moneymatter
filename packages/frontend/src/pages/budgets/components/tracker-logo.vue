<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import type { BudgetModel, EntityLogoFields } from '@bt/shared/types';
import { TargetIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{
  tracker?: Pick<BudgetModel, 'name' | keyof EntityLogoFields>;
}>();

const selection = computed(() => (props.tracker ? toLogoSelection(props.tracker) : null));
</script>

<template>
  <BrandLogo v-if="tracker && selection !== null" v-bind="toLogoDisplayProps({ selection })" :name="tracker.name" />
  <div v-else class="bg-muted text-muted-foreground grid shrink-0 place-items-center" aria-hidden="true">
    <TargetIcon class="size-1/2" />
  </div>
</template>
