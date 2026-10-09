<template>
  <div class="bg-background flex h-screen max-md:flex-col">
    <template v-if="!isMobileView">
      <SidebarRail v-if="isCollapsed" />
      <Sidebar v-else />
    </template>

    <ScrollArea ref="scrollAreaRef" class="flex-1" :scroll-area-id="SCROLL_AREA_IDS.dashboard">
      <ui-header class="bg-background sticky top-0 z-30" />

      <template v-if="isAppInitialized">
        <div class="max-md:pb-4">
          <router-view />
        </div>
      </template>

      <ScrollBar />
    </ScrollArea>

    <template v-if="isMobileView">
      <BottomNavbar />
    </template>

    <!-- Quick Start Onboarding Sidebar (desktop only) -->
    <template v-if="!isMobileView">
      <QuickStartSidebar />
    </template>

    <!-- Quick Start Onboarding (mobile: floating trigger + drawer) -->
    <template v-if="isMobileView">
      <QuickStartTrigger />
      <QuickStartPanel />
    </template>

    <!-- Share invitation dialog: opens whenever ?invitation_token=… is in the URL.
         Email links + in-app notifications deep-link via this query param. -->
    <ShareInvitationDialog :token="invitationToken" @close="clearInvitationToken" />
  </div>
</template>

<script lang="ts" setup>
import { useHead } from '@unhead/vue';
import BottomNavbar from '@/components/bottom-navbar.vue';
import ShareInvitationDialog from '@/components/dialogs/share-invitation-dialog.vue';
import { ScrollArea, ScrollBar } from '@/components/lib/ui/scroll-area';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { QuickStartPanel, QuickStartSidebar, QuickStartTrigger } from '@/components/quick-start';
import Sidebar from '@/components/sidebar/index.vue';
import SidebarRail from '@/components/sidebar/sidebar-rail.vue';
import { useSidebarCollapsed } from '@/components/sidebar/use-sidebar-collapsed';
import UiHeader from '@/components/ui-header.vue';
import { useIdleEnabled } from '@/composable/use-idle-enabled';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCurrenciesStore, useOnboardingStore, useRootStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});

const router = useRouter();
const route = useRoute();
const rootStore = useRootStore();
const userCurrenciesStore = useCurrenciesStore();
const onboardingStore = useOnboardingStore();
const idleEnabled = useIdleEnabled();
const { isCollapsed } = useSidebarCollapsed();
const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile, {
  wait: 50,
});

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);

watch(
  () => route.fullPath,
  () => {
    if (scrollAreaRef.value?.viewportRef?.viewportElement) {
      scrollAreaRef.value.viewportRef.viewportElement.scrollTop = 0;
    }
  },
);

const { isAppInitialized } = storeToRefs(rootStore);
const { isBaseCurrencyExists } = storeToRefs(userCurrenciesStore);

// The base-currency guard must run the instant the app is ready — it decides
// whether the user is even allowed on the dashboard — so it stays off the idle path.
watch(
  isAppInitialized,
  (value) => {
    if (value && !isBaseCurrencyExists.value) {
      router.push({ name: ROUTES_NAMES.welcome });
    }
  },
  { immediate: true },
);

// The onboarding "Quick Start" checklist is non-critical decoration, and the store
// already tracks task completion optimistically in memory — the fetched state only
// restores progress on a cold load. Defer it until the browser is idle so it stays
// off the dashboard's critical request path.
watch(
  [isAppInitialized, idleEnabled],
  ([initialized, idle]) => {
    if (initialized && idle) {
      onboardingStore.fetchOnboardingState();
    }
  },
  { immediate: true },
);

// Share invitation deep-link binding. The dialog opens whenever the URL carries
// `?invitation_token=…`. Closing the dialog clears the param so a refresh doesn't
// reopen it. (Replaces the previous standalone /shared-with-me/invitations/:token page.)
const invitationToken = computed(() => {
  const raw = route.query.invitation_token;
  return typeof raw === 'string' ? raw : '';
});

const clearInvitationToken = () => {
  if (!invitationToken.value) return;
  const { invitation_token: _omit, ...rest } = route.query;
  void _omit;
  router.replace({ ...route, query: rest });
};

// Watch route changes to auto-complete page-visit tasks
watch(
  () => route.name,
  (routeName) => {
    if (!onboardingStore.isInitialized) return;

    if (routeName === ROUTES_NAMES.analyticsCashFlow) {
      onboardingStore.completeTask('view-cash-flow');
    }
    if (routeName === ROUTES_NAMES.analytics || routeName === ROUTES_NAMES.analyticsTrendsComparison) {
      onboardingStore.completeTask('view-annual-overview');
    }
    if (routeName === ROUTES_NAMES.settingsAiFeatures) {
      onboardingStore.completeTask('review-ai-features');
    }
  },
);
</script>
