<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import type { EntityLogoFields, GoalModel } from '@bt/shared/types';
import { FlagIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{ goal: Pick<GoalModel, 'name' | keyof EntityLogoFields> }>();

const selection = computed(() => toLogoSelection(props.goal));
</script>

<template>
  <BrandLogo v-if="selection !== null" v-bind="toLogoDisplayProps({ selection })" :name="goal.name" />
  <div v-else class="bg-muted text-muted-foreground grid shrink-0 place-items-center" aria-hidden="true">
    <FlagIcon class="size-1/2" />
  </div>
</template>
