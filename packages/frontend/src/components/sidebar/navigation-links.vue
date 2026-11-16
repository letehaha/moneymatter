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
import { useSlidingIndicator } from '@/composable/use-sliding-indicator';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { SIDEBAR_NAV_CHILDREN, type SidebarNavChild, useAccountsNavChildren } from './nav-items';
import { useSidebarNavCollapse } from './use-nav-collapse';
import { useSidebarNavRoutes } from './use-nav-routes';

withDefaults(defineProps<{ bottomNav?: boolean }>(), { bottomNav: false });

const navItemBase = 'h-9 w-full gap-2 border px-3 touch:h-10';
const navChildBase = 'h-8 w-full justify-start gap-2 border px-3 touch:h-9';
const navItemIdle = 'border-transparent text-foreground dark:text-muted-foreground';
// `nav-item-active` carries no styles: it marks the item the sliding pill sits behind.
const navItemActive = 'nav-item-active border-transparent text-foreground hover:bg-transparent dark:hover:bg-hover';
// Idle and active classes never share an element: Button's fallthrough attrs re-apply the raw class list, so tailwind-merge can't settle conflicts between them.
const navItemState = ({ active, expanded = false }: { active: boolean; expanded?: boolean }) => {
  if (!active) return navItemIdle;
  return expanded ? 'border-transparent text-foreground' : navItemActive;
};
const navIconBase = 'size-4 shrink-0';
const navIconActive = 'text-primary-text';

const { isAccountsOpen, isTransactionsOpen, isPlannedOpen } = useSidebarNavCollapse();
const { isAccountsRoute, isTransactionsRoute, isPlannedRoute, isChildActive } = useSidebarNavRoutes();
const accountsNavChildren = useAccountsNavChildren();

const route = useRoute();
// An open section hands the highlight to its active child, but that child can be hidden by user settings.
const hasActiveChild = (children: SidebarNavChild[]) =>
  children.some((child) =>
    isChildActive({ child, isActive: route.matched.some((record) => record.name === child.routeName) }),
  );
const isChildHighlighted = computed(() => ({
  accounts: isAccountsOpen.value && hasActiveChild(accountsNavChildren.value),
  transactions: isTransactionsOpen.value && hasActiveChild(SIDEBAR_NAV_CHILDREN.transactions),
  planned: isPlannedOpen.value && hasActiveChild(SIDEBAR_NAV_CHILDREN.planned),
}));
const pillRef = ref<HTMLElement | null>(null);
// Opening or closing the section that holds the current page moves the pill between the parent and its child.
const isActiveSectionOpen = computed(
  () =>
    (isAccountsRoute.value && isAccountsOpen.value) ||
    (isTransactionsRoute.value && isTransactionsOpen.value) ||
    (isPlannedRoute.value && isPlannedOpen.value),
);
const { indicator } = useSlidingIndicator({
  containerRef: computed(() => pillRef.value?.parentElement),
  activeSelector: '.nav-item-active',
  activeKey: () => `${String(route.name)}|${isActiveSectionOpen.value}`,
});

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
  <div ref="pillRef" v-bind="indicator" />
  <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.home }">
    <ui-button
      variant="ghost"
      as="span"
      :class="[navItemBase, !bottomNav && 'justify-start', navItemState({ active: isActive })]"
      size="default"
    >
      <LayoutDashboardIcon :class="[navIconBase, isActive && navIconActive]" />
      <span :class="{ 'max-sm:hidden': bottomNav }"> {{ $t('navigation.dashboard') }} </span>
    </ui-button>
  </router-link>

  <template v-if="bottomNav">
    <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.accounts }">
      <ui-button variant="ghost" as="span" :class="[navItemBase, navItemState({ active: isActive })]" size="default">
        <LayersIcon :class="[navIconBase, isActive && navIconActive]" />
        <span class="max-sm:hidden"> {{ $t('navigation.accounts') }} </span>
      </ui-button>
    </router-link>
  </template>
  <router-link v-else-if="accountsNavChildren.length === 1" :to="{ name: ROUTES_NAMES.accounts }">
    <ui-button
      variant="ghost"
      as="span"
      :class="[navItemBase, 'justify-start', navItemState({ active: isAccountsRoute })]"
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
        :class="[
          navItemBase,
          'justify-start',
          navItemState({ active: isAccountsRoute, expanded: isChildHighlighted.accounts }),
        ]"
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
            :class="[navChildBase, navItemState({ active: isChildActive({ child, isActive }) })]"
            size="sm"
          >
            <component :is="child.icon" :class="[navIconBase, isChildActive({ child, isActive }) && navIconActive]" />
            <span>{{ $t(child.labelKey) }}</span>
          </ui-button>
        </router-link>
      </div>
    </CollapsibleContent>
  </Collapsible>

  <template v-if="bottomNav">
    <router-link v-slot="{ isActive }" :to="{ name: ROUTES_NAMES.transactions }">
      <ui-button variant="ghost" as="span" :class="[navItemBase, navItemState({ active: isActive })]" size="default">
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
        :class="[
          navItemBase,
          'justify-start',
          navItemState({ active: isTransactionsRoute, expanded: isChildHighlighted.transactions }),
        ]"
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
            :class="[navChildBase, navItemState({ active: isChildActive({ child, isActive }) })]"
            size="sm"
          >
            <component :is="child.icon" :class="[navIconBase, isChildActive({ child, isActive }) && navIconActive]" />
            <span>{{ $t(child.labelKey) }}</span>
          </ui-button>
        </router-link>
      </div>
    </CollapsibleContent>
  </Collapsible>

  <Collapsible v-if="!bottomNav" v-model:open="isPlannedOpen">
    <CollapsibleTrigger class="w-full">
      <ui-button
        variant="ghost"
        as="div"
        :class="[
          navItemBase,
          'justify-start',
          navItemState({ active: isPlannedRoute, expanded: isChildHighlighted.planned }),
        ]"
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
            :class="[navChildBase, navItemState({ active: isChildActive({ child, isActive }) })]"
            size="sm"
          >
            <component :is="child.icon" :class="[navIconBase, isChildActive({ child, isActive }) && navIconActive]" />
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
      :class="[navItemBase, !bottomNav && 'justify-start', navItemState({ active: isActive })]"
      size="default"
    >
      <ChartColumnIcon :class="[navIconBase, isActive && navIconActive]" />
      <span :class="{ 'max-sm:hidden': bottomNav }"> {{ $t('navigation.analytics') }} </span>
    </ui-button>
  </router-link>
</template>
