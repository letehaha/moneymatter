<script setup lang="ts">
import FeedbackIcon from '@/components/common/icons/feedback-icon.vue';
import ResizeHandle from '@/components/common/resize-handle.vue';
import FeedbackDialog from '@/components/dialogs/feedback-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFeedbackAttention } from '@/composable/use-feedback-attention';
import { useResizableWidth } from '@/composable/use-resizable-width';
import { useSupportButton } from '@/composable/use-support-button';
import { HeartIcon, PanelLeftIcon } from '@lucide/vue';

import AccountsView from './accounts-view/index.vue';
import NavigationLinks from './navigation-links.vue';
import UserMenu from './user-menu.vue';
import { useSidebarCollapsed } from './use-sidebar-collapsed';

defineProps<{ mobileView?: boolean }>();

const { isCollapsed } = useSidebarCollapsed();
const { width, startResize, resetWidth } = useResizableWidth({
  storageKey: 'sidebar:width',
  minWidth: 220,
  maxWidth: 420,
  defaultWidth: 300,
  edge: 'right',
});
const { isPulsing: isFeedbackPulsing, onClick: onFeedbackClick } = useFeedbackAttention();
const { isSupportButtonVisible, openSupport } = useSupportButton();
</script>

<template>
  <component
    :is="mobileView ? 'div' : Card"
    class="relative flex h-full flex-col rounded-none"
    :style="mobileView ? undefined : { width: `${width}px` }"
  >
    <ResizeHandle
      v-if="!mobileView"
      edge="right"
      :label="$t('sidebar.resize')"
      @start="startResize"
      @reset="resetWidth"
    />
    <CardHeader class="h-14 px-4 py-3">
      <div class="text-lg font-semibold tracking-tight">MoneyMatter</div>
    </CardHeader>
    <CardContent class="flex max-h-[calc(100%-56px)] grow flex-col gap-3 px-3 pt-0 pb-3 sm:p-3 sm:pt-0">
      <nav class="grid gap-0.5">
        <NavigationLinks />
      </nav>

      <div class="bg-border/50 mx-1 h-px" />

      <AccountsView />

      <div v-if="!mobileView" class="bg-border/50 mx-1 h-px" />

      <UserMenu :elevated="mobileView">
        <template #trailing>
          <DesktopOnlyTooltip v-if="!mobileView" :content="$t('sidebar.collapse')">
            <UiButton variant="ghost" size="icon-sm" :aria-label="$t('sidebar.collapse')" @click="isCollapsed = true">
              <PanelLeftIcon class="size-4" />
            </UiButton>
          </DesktopOnlyTooltip>
          <template v-else>
            <FeedbackDialog>
              <UiButton
                variant="ghost"
                size="icon-sm"
                :class="{ 'feedback-pulse': isFeedbackPulsing }"
                :aria-label="$t('header.feedback')"
                @click="onFeedbackClick"
              >
                <FeedbackIcon class="text-primary-text size-4" />
              </UiButton>
            </FeedbackDialog>
            <UiButton
              v-if="isSupportButtonVisible"
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('header.support')"
              @click="openSupport"
            >
              <HeartIcon class="text-heart size-4 fill-current" />
            </UiButton>
          </template>
        </template>
      </UserMenu>
    </CardContent>
  </component>
</template>
