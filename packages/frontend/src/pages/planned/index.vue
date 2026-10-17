<template>
  <div
    :class="
      cn(
        'flex flex-col p-4 md:px-6',
        isMobileView
          ? 'min-h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))]'
          : 'min-h-[calc(100dvh-var(--header-height))]',
      )
    "
  >
    <!-- Back button -->
    <BackLink v-if="isOnNestedChildRoute" :to="backLinkTarget">
      {{ backLinkLabel }}
    </BackLink>

    <router-view />
  </div>
</template>

<script setup lang="ts">
import BackLink from '@/components/common/back-link.vue';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

const route = useRoute();
const { t } = useI18n();

const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile, {
  wait: 50,
});

const nestedRouteMap: Record<string, { parent: { name: string }; labelKey?: string; label?: string }> = {
  [ROUTES_NAMES.plannedSubscriptionDetails]: {
    parent: { name: ROUTES_NAMES.plannedSubscriptions },
    labelKey: 'planned.subscriptions.backToList',
  },
  [ROUTES_NAMES.plannedBudgetDetails]: {
    parent: { name: ROUTES_NAMES.plannedBudgets },
    labelKey: 'planned.budgets.backToList',
  },
};

const isOnNestedChildRoute = computed(() => !!nestedRouteMap[route.name as string]);
const backLinkTarget = computed(() => nestedRouteMap[route.name as string]?.parent ?? { name: ROUTES_NAMES.planned });
const backLinkLabel = computed(() => {
  const entry = nestedRouteMap[route.name as string];
  if (!entry) return '';
  return entry.labelKey ? t(entry.labelKey) : '';
});
</script>
