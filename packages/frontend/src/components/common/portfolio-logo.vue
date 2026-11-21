<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { toLogoDisplayProps, toLogoSelection } from '@/components/common/logo-selection';
import { cn } from '@/lib/utils';
import type { EntityLogoFields } from '@bt/shared/types';
import { PORTFOLIO_TYPE, type PortfolioModel } from '@bt/shared/types/investments';
import { BriefcaseIcon, Building2Icon, LandmarkIcon, PiggyBankIcon } from '@lucide/vue';
import { computed } from 'vue';

const TYPE_ICONS = {
  [PORTFOLIO_TYPE.investment]: Building2Icon,
  [PORTFOLIO_TYPE.retirement]: LandmarkIcon,
  [PORTFOLIO_TYPE.savings]: PiggyBankIcon,
  [PORTFOLIO_TYPE.other]: BriefcaseIcon,
};

const TYPE_CHIP_CLASSES = {
  [PORTFOLIO_TYPE.investment]: 'bg-account-checking/15 text-account-checking',
  [PORTFOLIO_TYPE.retirement]: 'bg-account-saving/15 text-account-saving',
  [PORTFOLIO_TYPE.savings]: 'bg-account-credit/15 text-account-credit',
  [PORTFOLIO_TYPE.other]: 'bg-muted text-muted-foreground',
};

const props = defineProps<{
  portfolio: Pick<PortfolioModel, 'name' | 'portfolioType' | keyof EntityLogoFields>;
}>();

const selection = computed(() => toLogoSelection(props.portfolio));

// Fall back to `other` so an unrecognized portfolioType still renders.
const chipClass = computed(
  () => TYPE_CHIP_CLASSES[props.portfolio.portfolioType] ?? TYPE_CHIP_CLASSES[PORTFOLIO_TYPE.other],
);
const chipIcon = computed(() => TYPE_ICONS[props.portfolio.portfolioType] ?? BriefcaseIcon);
</script>

<template>
  <BrandLogo v-if="selection" v-bind="toLogoDisplayProps({ selection })" :name="portfolio.name" />
  <div v-else :class="cn('grid shrink-0 place-items-center rounded-lg', chipClass)" aria-hidden="true">
    <component :is="chipIcon" class="size-1/2" />
  </div>
</template>
