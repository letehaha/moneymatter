<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import type { EntityLogoFields, VentureDealModel } from '@bt/shared/types';
import { RocketIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{ deal: Pick<VentureDealModel, 'name' | keyof EntityLogoFields> }>();

const selection = computed(() => toLogoSelection(props.deal));
</script>

<template>
  <BrandLogo v-if="selection" v-bind="toLogoDisplayProps({ selection })" :name="deal.name" />
  <div v-else class="bg-muted text-muted-foreground grid shrink-0 place-items-center rounded-lg" aria-hidden="true">
    <RocketIcon class="size-1/2" />
  </div>
</template>
