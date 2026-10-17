<template>
  <div
    ref="containerRef"
    :class="
      cn(
        'flex min-h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))] flex-col p-4 sm:flex-row',
        isTransitionReady && 'transition-all duration-200',
        isIconOnly ? 'gap-2 md:pr-6 md:pl-2' : 'gap-6 md:px-6',
        isMobileView
          ? 'min-h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))]'
          : 'min-h-[calc(100dvh-var(--header-height))]',
        (isOnChildRoute || !isCompactLayout) && 'pt-4',
      )
    "
  >
    <!-- Sidebar Navigation (wide: always visible, compact: only on root) -->
    <nav
      v-if="!isOnChildRoute || !isCompactLayout"
      :class="[
        'border-border bg-card/50 shrink-0 rounded-lg border backdrop-blur-sm',
        isTransitionReady && 'transition-all duration-200',
        isCompactLayout ? 'w-full' : isCollapsed ? 'w-14' : 'w-full lg:w-52',
        !isCompactLayout && 'sticky top-[calc(var(--header-height)+1rem)] self-start',
      ]"
    >
      <ScrollArea :class="navMaxHeight" :viewport-class="cn('p-2', navMaxHeight)">
        <div class="flex flex-col gap-4 overflow-hidden">
          <button
            v-if="!isCompactLayout"
            :class="
              cn(
                'text-muted-foreground flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                'hover:bg-accent hover:text-foreground',
              )
            "
            @click="isCollapsed = !isCollapsed"
          >
            <PanelLeftCloseIcon v-if="!isCollapsed" class="size-4 shrink-0" />
            <PanelLeftOpenIcon v-else class="size-4 shrink-0" />
            <span
              :class="['whitespace-nowrap transition-opacity duration-200', isCollapsed ? 'opacity-0' : 'opacity-100']"
            >
              {{ $t('settings.navigation.collapse') }}
            </span>
          </button>

          <div v-for="(group, groupIndex) in groups" :key="group.key" class="flex flex-col gap-1">
            <div
              v-if="!isIconOnly"
              class="text-muted-foreground px-3 pt-1 text-[11px] font-semibold tracking-wider uppercase"
            >
              {{ group.label }}
            </div>
            <div v-else-if="groupIndex > 0" class="border-border mx-1 mb-1 border-t" />
            <ul class="flex flex-col gap-1">
              <li v-for="tab in group.tabs" :key="tab.name">
                <DesktopOnlyTooltip :content="tab.label" :disabled="!isIconOnly" side="right">
                  <router-link
                    :to="tab.to"
                    :class="
                      cn(
                        'text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 whitespace-nowrap transition-colors',
                        'hover:bg-accent hover:text-foreground',
                        '[&.router-link-active]:bg-accent [&.router-link-active]:text-foreground',
                        isCompactLayout ? 'text-sm md:gap-4 md:text-base' : 'text-sm',
                      )
                    "
                  >
                    <component :is="tab.icon" :class="cn('size-4 shrink-0', isCompactLayout && 'md:size-5')" />
                    <span :class="['transition-opacity duration-200', isIconOnly ? 'opacity-0' : 'opacity-100']">
                      {{ tab.label }}
                    </span>
                    <NewBadge
                      v-if="tab.badgeSince && !isIconOnly"
                      :since="tab.badgeSince"
                      :ttl-days="tab.badgeTtlDays"
                    />
                    <ChevronRightIcon v-if="isCompactLayout" class="text-muted-foreground ml-auto size-4" />
                  </router-link>
                </DesktopOnlyTooltip>
              </li>
            </ul>
          </div>

          <div class="border-border border-t pt-2">
            <DesktopOnlyTooltip :content="$t('navigation.helpAndDocs')" :disabled="!isIconOnly" side="right">
              <a
                :href="config.docsUrl"
                target="_blank"
                rel="noopener noreferrer"
                :class="
                  cn(
                    'text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 whitespace-nowrap transition-colors',
                    'hover:bg-accent hover:text-foreground',
                    isCompactLayout ? 'text-sm md:gap-4 md:text-base' : 'text-sm',
                  )
                "
              >
                <BookOpenIcon :class="cn('size-4 shrink-0', isCompactLayout && 'md:size-5')" />
                <span :class="['transition-opacity duration-200', isIconOnly ? 'opacity-0' : 'opacity-100']">
                  {{ $t('navigation.helpAndDocs') }}
                </span>
                <ExternalLinkIcon v-if="!isIconOnly" class="text-muted-foreground ml-auto size-3" />
              </a>
            </DesktopOnlyTooltip>
          </div>
        </div>
      </ScrollArea>
    </nav>

    <!-- Content Area (wide: always visible, compact: only on child routes) -->
    <div v-if="isOnChildRoute || !isCompactLayout" class="min-w-0 flex-1">
      <!-- Back button (compact layout only) -->
      <BackLink v-if="isCompactLayout" :to="{ name: ROUTES_NAMES.settings }">
        {{ $t('settings.backToSettings') }}
      </BackLink>

      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { config } from '@/common/config';
import BackLink from '@/components/common/back-link.vue';
import NewBadge from '@/components/common/new-badge.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { usePushConfig } from '@/composable/data-queries/web-push';
import { useAfterMountTransition } from '@/composable/use-after-mount-transition';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useUserStore } from '@/stores';
import { useElementSize, useLocalStorage } from '@vueuse/core';
import {
  BellIcon,
  BookOpenIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  HomeIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LayersIcon,
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  StoreIcon,
  TagIcon,
  TagsIcon,
  UploadIcon,
  UsersIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { type Component, computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouteLocationRaw, useRoute, useRouter } from 'vue-router';

interface Tab {
  name: string;
  label: string;
  to: RouteLocationRaw;
  icon: Component;
  badgeSince?: string;
  badgeTtlDays?: number;
}

interface TabGroup {
  key: string;
  label: string;
  tabs: Tab[];
}

const route = useRoute();
const router = useRouter();
const { user, canSeeBilling } = storeToRefs(useUserStore());
const { t } = useI18n();
const { config: pushConfig } = usePushConfig();

const containerRef = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(containerRef);

const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile, {
  wait: 50,
});

const isCompactLayout = computed(() => containerWidth.value < 920);
const navMaxHeight = computed(() => (isCompactLayout.value ? '' : 'max-h-[calc(100dvh-var(--header-height)-2rem)]'));
const isCollapsed = useLocalStorage('settings-sidebar-collapsed', false);
const isIconOnly = computed(() => isCollapsed.value && !isCompactLayout.value);
const isTransitionReady = useAfterMountTransition();
const showAdminTab = ref(user.value?.isAdmin ?? false);

const isOnChildRoute = computed(() => route.name !== ROUTES_NAMES.settings);

// On wide layout, redirect to first Personal tab if on root settings
watch(
  [isCompactLayout, () => route.name],
  ([compact, routeName]) => {
    if (!compact && routeName === ROUTES_NAMES.settings) {
      router.replace({ name: ROUTES_NAMES.settingsAppearance });
    }
  },
  { immediate: true },
);

const personalTabs = computed<Tab[]>(() => [
  {
    name: 'appearance',
    label: t('settings.navigation.appearance'),
    to: { name: ROUTES_NAMES.settingsAppearance },
    icon: PaletteIcon,
  },
  {
    name: 'language',
    label: t('settings.navigation.language'),
    to: { name: ROUTES_NAMES.settingsLanguage },
    icon: LanguagesIcon,
  },
  {
    name: 'general',
    label: t('settings.navigation.general'),
    to: { name: ROUTES_NAMES.settingsGeneral },
    icon: SettingsIcon,
  },
  {
    name: 'security',
    label: t('settings.navigation.security'),
    to: { name: ROUTES_NAMES.settingsSecurity },
    icon: KeyRoundIcon,
  },
  // Shown only once the server says it can send pushes; without VAPID keys the page has nothing to offer.
  ...(pushConfig.value?.enabled
    ? [
        {
          name: 'notifications',
          label: t('settings.navigation.notifications'),
          to: { name: ROUTES_NAMES.settingsNotifications },
          icon: BellIcon,
          badgeSince: '2026-10-18',
        },
      ]
    : []),
  ...(canSeeBilling.value
    ? [
        {
          name: 'plan-billing',
          label: t('settings.navigation.planBilling'),
          to: { name: ROUTES_NAMES.settingsPlanBilling },
          icon: CreditCardIcon,
        },
      ]
    : []),
]);

const workspaceTabs = computed<Tab[]>(() => {
  const tabs: Tab[] = [
    {
      name: 'currencies',
      label: t('settings.navigation.currencies'),
      to: { name: ROUTES_NAMES.settingsCurrencies },
      icon: CircleDollarSignIcon,
    },
    {
      name: 'categories',
      label: t('settings.navigation.categories'),
      to: { name: ROUTES_NAMES.settingsCategories },
      icon: TagsIcon,
    },
    {
      name: 'tags',
      label: t('settings.navigation.tags'),
      to: { name: ROUTES_NAMES.settingsTags },
      icon: TagIcon,
    },
    {
      name: 'payees',
      label: t('settings.navigation.payees'),
      to: { name: ROUTES_NAMES.settingsPayees },
      icon: StoreIcon,
    },
    {
      name: 'subscriptions',
      label: t('settings.navigation.subscriptions'),
      to: { name: ROUTES_NAMES.settingsSubscriptions },
      icon: CalendarClockIcon,
    },
    {
      name: 'accounts',
      label: t('settings.navigation.accountsGroups'),
      to: { name: ROUTES_NAMES.settingsAccounts },
      icon: LayersIcon,
    },
    {
      name: 'data-management',
      label: t('settings.navigation.importData'),
      to: { name: ROUTES_NAMES.settingsDataManagement },
      icon: UploadIcon,
    },
    {
      name: 'ai',
      label: t('settings.navigation.ai'),
      to: { name: ROUTES_NAMES.settingsAi },
      icon: SparklesIcon,
    },
    {
      name: 'shared-with-me',
      label: t('settings.navigation.sharedWithMe'),
      to: { name: ROUTES_NAMES.settingsSharedWithMe },
      icon: UsersIcon,
    },
    {
      name: 'household',
      label: t('settings.navigation.household'),
      to: { name: ROUTES_NAMES.settingsHousehold },
      icon: HomeIcon,
      badgeSince: '2026-05-14',
    },
  ];

  if (showAdminTab.value) {
    tabs.push({
      name: 'admin',
      label: t('settings.navigation.admin'),
      to: { name: ROUTES_NAMES.settingsAdmin },
      icon: ShieldIcon,
    });
  }

  return tabs;
});

const groups = computed<TabGroup[]>(() => [
  {
    key: 'personal',
    label: t('settings.navigation.personalGroup'),
    tabs: personalTabs.value,
  },
  {
    key: 'workspace',
    label: t('settings.navigation.workspaceGroup'),
    tabs: workspaceTabs.value,
  },
]);
</script>
