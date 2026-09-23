<script setup lang="ts">
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { ROUTES_NAMES } from '@/routes';
import {
  CalendarClockIcon,
  ChartColumnIcon,
  ChevronRightIcon,
  CreditCardIcon,
  LayersIcon,
  LayoutDashboardIcon,
} from '@lucide/vue';
import { watch } from 'vue';

import { SIDEBAR_BUDGET_NAV_ITEM, SIDEBAR_NAV_CHILDREN, useAccountsNavChildren } from './nav-items';
import { useSidebarNavCollapse } from './use-nav-collapse';
import { useSidebarNavRoutes } from './use-nav-routes';

withDefaults(defineProps<{ bottomNav?: boolean }>(), { bottomNav: false });

const navItemBase = 'w-full gap-2 px-3';
const navItemActive = 'bg-primary/10 text-foreground';
const navIconBase = 'size-4 shrink-0';
const navIconActive = 'text-primary-text';

const { isAccountsOpen, isTransactionsOpen, isPlannedOpen } = useSidebarNavCollapse();
const { isAccountsRoute, isTransactionsRoute, isBudgetRoute, isPlannedRoute } = useSidebarNavRoutes();
const accountsNavChildren = useAccountsNavChildren();

watch(
  isAccountsRoute,
  (val) => {
    if (val) isAccountsOpen.value = true;
  },
  { immediate: true },
);

watch(
  isTransactionsRoute,
  (val) => {
    if (val) isTransactionsOpen.value = true;
  },
  { immediate: true },
);

watch(
  isPlannedRoute,
  (val) => {
    if (val) isPlannedOpen.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.home }">
    <ui-button
      variant="ghost"
      as="span"
      :class="[navItemBase, !bottomNav && 'justify-start', isActive && navItemActive]"
      size="default"
    >
      <LayoutDashboardIcon :class="[navIconBase, isActive && navIconActive]" />
      <span :class="{ 'max-sm:hidden': bottomNav }"> {{ $t('navigation.dashboard') }} </span>
    </ui-button>
  </router-link>

  <template v-if="bottomNav">
    <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.accounts }">
      <ui-button variant="ghost" as="span" :class="[navItemBase, isActive && navItemActive]" size="default">
        <LayersIcon :class="[navIconBase, isActive && navIconActive]" />
        <span class="max-sm:hidden"> {{ $t('navigation.accounts') }} </span>
      </ui-button>
    </router-link>
  </template>
  <router-link v-else-if="accountsNavChildren.length === 1" :to="{ name: ROUTES_NAMES.accounts }">
    <ui-button
      variant="ghost"
      as="span"
      :class="[navItemBase, 'justify-start', isAccountsRoute && navItemActive]"
      size="default"
    >
      <LayersIcon :class="[navIconBase, isAccountsRoute && navIconActive]" />
      <span> {{ $t('navigation.accounts') }} </span>
    </ui-button>
  </router-link>
  <Collapsible v-else v-model:open="isAccountsOpen">
    <CollapsibleTrigger class="w-full">
      <ui-button
        variant="ghost"
        as="div"
        :class="['w-full justify-start gap-2 px-3', isAccountsRoute && 'bg-primary/10']"
        size="default"
      >
        <LayersIcon :class="[navIconBase, isAccountsRoute && navIconActive]" />
        <span>{{ $t('navigation.accounts') }}</span>
        <ChevronRightIcon
          :class="['ml-auto size-4 shrink-0 transition-transform duration-200', { 'rotate-90': isAccountsOpen }]"
        />
      </ui-button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="border-border/40 mt-1 ml-2 grid gap-0.5 border-l pl-2">
        <router-link
          v-for="child in accountsNavChildren"
          :key="child.routeName"
          v-slot="{ isActive }"
          :to="{ name: child.routeName }"
        >
          <ui-button
            variant="ghost"
            as="span"
            :class="['w-full justify-start gap-2 px-3', isActive && navItemActive]"
            size="sm"
          >
            <component :is="child.icon" :class="[navIconBase, isActive && navIconActive]" />
            <span>{{ $t(child.labelKey) }}</span>
          </ui-button>
        </router-link>
      </div>
    </CollapsibleContent>
  </Collapsible>

  <template v-if="bottomNav">
    <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.transactions }">
      <ui-button variant="ghost" as="span" :class="[navItemBase, isActive && navItemActive]" size="default">
        <CreditCardIcon :class="[navIconBase, isActive && navIconActive]" />
        <span class="max-sm:hidden"> {{ $t('navigation.transactions') }} </span>
      </ui-button>
    </router-link>
  </template>
  <Collapsible v-else v-model:open="isTransactionsOpen">
    <CollapsibleTrigger class="w-full">
      <ui-button
        variant="ghost"
        as="div"
        :class="['w-full justify-start gap-2 px-3', isTransactionsRoute && 'bg-primary/10']"
        size="default"
      >
        <CreditCardIcon :class="[navIconBase, isTransactionsRoute && navIconActive]" />
        <span>{{ $t('navigation.transactions') }}</span>
        <ChevronRightIcon
          :class="['ml-auto size-4 shrink-0 transition-transform duration-200', { 'rotate-90': isTransactionsOpen }]"
        />
      </ui-button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="border-border/40 mt-1 ml-2 grid gap-0.5 border-l pl-2">
        <router-link
          v-for="child in SIDEBAR_NAV_CHILDREN.transactions"
          :key="child.routeName"
          v-slot="{ isActive }"
          :to="{ name: child.routeName }"
        >
          <ui-button
            variant="ghost"
            as="span"
            :class="['w-full justify-start gap-2 px-3', isActive && navItemActive]"
            size="sm"
          >
            <component :is="child.icon" :class="[navIconBase, isActive && navIconActive]" />
            <span>{{ $t(child.labelKey) }}</span>
          </ui-button>
        </router-link>
      </div>
    </CollapsibleContent>
  </Collapsible>

  <router-link v-if="!bottomNav" :to="{ name: SIDEBAR_BUDGET_NAV_ITEM.routeName }">
    <ui-button
      variant="ghost"
      as="span"
      :class="[navItemBase, 'justify-start', isBudgetRoute && navItemActive]"
      size="default"
    >
      <component :is="SIDEBAR_BUDGET_NAV_ITEM.icon" :class="[navIconBase, isBudgetRoute && navIconActive]" />
      <span>{{ $t(SIDEBAR_BUDGET_NAV_ITEM.labelKey) }}</span>
    </ui-button>
  </router-link>

  <Collapsible v-if="!bottomNav" v-model:open="isPlannedOpen">
    <CollapsibleTrigger class="w-full">
      <ui-button
        variant="ghost"
        as="div"
        :class="['w-full justify-start gap-2 px-3', isPlannedRoute && 'bg-primary/10']"
        size="default"
      >
        <CalendarClockIcon :class="[navIconBase, isPlannedRoute && navIconActive]" />
        <span>{{ $t('navigation.planned.planned') }}</span>
        <ChevronRightIcon
          :class="['ml-auto size-4 shrink-0 transition-transform duration-200', { 'rotate-90': isPlannedOpen }]"
        />
      </ui-button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="border-border/40 mt-1 ml-2 grid gap-0.5 border-l pl-2">
        <router-link
          v-for="child in SIDEBAR_NAV_CHILDREN.planned"
          :key="child.routeName"
          v-slot="{ isActive }"
          :to="{ name: child.routeName }"
        >
          <ui-button
            variant="ghost"
            as="span"
            :class="['w-full justify-start gap-2 px-3', isActive && navItemActive]"
            size="sm"
          >
            <component :is="child.icon" :class="[navIconBase, isActive && navIconActive]" />
            <span>{{ $t(child.labelKey) }}</span>
          </ui-button>
        </router-link>
      </div>
    </CollapsibleContent>
  </Collapsible>

  <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.analytics }">
    <ui-button
      variant="ghost"
      as="span"
      :class="[navItemBase, !bottomNav && 'justify-start', isActive && navItemActive]"
      size="default"
    >
      <ChartColumnIcon :class="[navIconBase, isActive && navIconActive]" />
      <span :class="{ 'max-sm:hidden': bottomNav }"> {{ $t('navigation.analytics') }} </span>
    </ui-button>
  </router-link>
</template>
