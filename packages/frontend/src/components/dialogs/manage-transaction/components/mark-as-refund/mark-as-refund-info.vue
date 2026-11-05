<script lang="ts" setup>
import DocsLink from '@/components/common/docs-link.vue';
import * as Drawer from '@/components/lib/ui/drawer';
import * as Popover from '@/components/lib/ui/popover';
import * as ScrollArea from '@/components/lib/ui/scroll-area';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { InfoIcon } from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const [UseTriggerTemplate, TriggerContent] = createReusableTemplate();
const [UseBodyTemplate, BodyContent] = createReusableTemplate();
</script>

<template>
  <UseTriggerTemplate>
    <span class="text-primary-text inline-flex cursor-pointer items-center gap-1 hover:underline">
      {{ t('dialogs.manageTransaction.refundInfo.trigger') }} <InfoIcon :size="16" />
    </span>
  </UseTriggerTemplate>

  <UseBodyTemplate>
    <h4 class="mt-3 mb-1 font-semibold">{{ t('dialogs.manageTransaction.refundInfo.howItWorks.title') }}</h4>
    <ul class="text-muted-foreground list-disc pl-5 text-sm">
      <li>{{ t('dialogs.manageTransaction.refundInfo.howItWorks.expenseRefund') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.howItWorks.incomeRefund') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.howItWorks.noOriginal') }}</li>
    </ul>

    <h4 class="mt-3 mb-1 font-semibold">{{ t('dialogs.manageTransaction.refundInfo.benefits.title') }}</h4>
    <ul class="text-muted-foreground list-disc pl-5 text-sm">
      <li>{{ t('dialogs.manageTransaction.refundInfo.benefits.accuracy') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.benefits.tracking') }}</li>
    </ul>

    <h4 class="mt-3 mb-1 font-semibold">{{ t('dialogs.manageTransaction.refundInfo.notes.title') }}</h4>
    <ul class="text-muted-foreground list-disc pl-5 text-sm">
      <li>{{ t('dialogs.manageTransaction.refundInfo.notes.recordKeeping') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.notes.noBalanceAdjust') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.notes.canUnlink') }}</li>
    </ul>

    <h4 class="mt-3 mb-1 font-semibold">{{ t('dialogs.manageTransaction.refundInfo.examples.title') }}</h4>
    <ul class="text-muted-foreground list-disc pl-5 text-sm">
      <li>{{ t('dialogs.manageTransaction.refundInfo.examples.customerPayment') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.examples.vendorRefund') }}</li>
      <li>{{ t('dialogs.manageTransaction.refundInfo.examples.noOriginalTx') }}</li>
    </ul>

    <div class="border-border mt-4 border-t pt-3 text-sm">
      <DocsLink path="/transfers-and-refunds/refunds/" />
    </div>
  </UseBodyTemplate>

  <Drawer.Drawer v-if="isMobile">
    <Drawer.DrawerTrigger as-child>
      <TriggerContent />
    </Drawer.DrawerTrigger>
    <Drawer.DrawerContent class="max-h-[85dvh]">
      <div class="min-h-0 overflow-y-auto px-4 pt-4 pb-6">
        <Drawer.DrawerTitle>{{ t('dialogs.manageTransaction.refundInfo.title') }}</Drawer.DrawerTitle>
        <Drawer.DrawerDescription class="mt-2">
          {{ t('dialogs.manageTransaction.refundInfo.description') }}
        </Drawer.DrawerDescription>
        <BodyContent />
      </div>
    </Drawer.DrawerContent>
  </Drawer.Drawer>

  <Popover.Popover v-else>
    <Popover.PopoverTrigger as-child>
      <TriggerContent />
    </Popover.PopoverTrigger>
    <Popover.PopoverContent class="w-125 overflow-y-auto" side="right">
      <ScrollArea.ScrollArea
        class="*:data-reka-scroll-area-viewport:max-h-[90dvh]"
        :scroll-area-id="SCROLL_AREA_IDS.txRefundInfo"
      >
        <h3 class="mb-2 text-lg font-bold">{{ t('dialogs.manageTransaction.refundInfo.title') }}</h3>
        <p class="text-muted-foreground text-sm">
          {{ t('dialogs.manageTransaction.refundInfo.description') }}
        </p>
        <BodyContent />
      </ScrollArea.ScrollArea>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>
