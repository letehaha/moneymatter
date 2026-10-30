<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import { cn } from '@/lib/utils';
import { getLoanTypeIcon, getLoanTypeTintedChipClass } from '@/pages/loans/loan-type-presentation';
import type { EntityLogoFields } from '@bt/shared/types';
import { computed } from 'vue';

const props = defineProps<{ loan: Pick<LoanApi, 'name' | 'loanDetails' | keyof EntityLogoFields> }>();

const selection = computed(() => toLogoSelection(props.loan));
const loanType = computed(() => props.loan.loanDetails.loanType);
</script>

<template>
  <BrandLogo v-if="selection" v-bind="toLogoDisplayProps({ selection })" :name="loan.name" />
  <div
    v-else
    :class="cn('flex shrink-0 items-center justify-center rounded-lg', getLoanTypeTintedChipClass({ loanType }))"
    aria-hidden="true"
  >
    <component :is="getLoanTypeIcon({ loanType })" class="size-1/2" stroke-width="2" />
  </div>
</template>
