<script setup lang="ts">
import { setWatchlistLayout } from '@/api/watchlist';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import type { WatchlistModel } from '@bt/shared/types';
import { GripVerticalIcon } from '@lucide/vue';
import { ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';

import { useWatchlistMutation } from './use-watchlist';
import { type WatchlistLayoutState, buildLayoutPayload, layoutStateFrom } from './watchlist-helpers';

const props = defineProps<{ portfolioId: string; watchlist: WatchlistModel }>();
const isOpen = defineModel<boolean>('open', { required: true });

const ITEMS_GROUP = 'watchlist-layout-items';
const DRAG_PROPS = { animation: 200, delay: 150, delayOnTouchOnly: true, ghostClass: 'opacity-40' } as const;

const state = ref<WatchlistLayoutState>({ ungrouped: [], sections: [] });

watch(isOpen, (open) => {
  if (open) state.value = layoutStateFrom({ watchlist: props.watchlist });
});

const close = () => {
  isOpen.value = false;
};

const { isPending, mutate } = useWatchlistMutation({
  mutationFn: setWatchlistLayout,
  successKey: 'portfolioDetail.watchlist.layout.saved',
  errorKey: 'portfolioDetail.watchlist.layout.saveError',
  onSuccess: close,
});

const save = () => {
  if (isPending.value) return;
  mutate({ portfolioId: props.portfolioId, payload: buildLayoutPayload({ state: state.value }) });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-lg">
    <template #title>{{ $t('portfolioDetail.watchlist.layout.title') }}</template>
    <template #description>{{ $t('portfolioDetail.watchlist.layout.description') }}</template>

    <!-- data-vaul-no-drag keeps the mobile drawer from treating a drag as a swipe to close. -->
    <div class="grid gap-3" data-vaul-no-drag>
      <section class="border-border rounded-lg border border-dashed">
        <h3 class="text-muted-foreground px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
          {{ $t('portfolioDetail.watchlist.notInSection') }}
        </h3>
        <VueDraggable
          v-model="state.ungrouped"
          :group="ITEMS_GROUP"
          v-bind="DRAG_PROPS"
          class="flex min-h-10 flex-col gap-0.5 p-1.5"
        >
          <div
            v-for="item in state.ungrouped"
            :key="item.id"
            class="hover:bg-hover flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          >
            <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
            <span class="font-medium">{{ item.security.symbol }}</span>
            <span class="text-muted-foreground min-w-0 truncate text-xs">{{ item.security.name }}</span>
          </div>
        </VueDraggable>
      </section>

      <VueDraggable
        v-model="state.sections"
        handle=".section-drag-handle"
        v-bind="DRAG_PROPS"
        class="flex flex-col gap-3"
      >
        <section v-for="section in state.sections" :key="section.id" class="border-border rounded-lg border">
          <div class="section-drag-handle bg-muted flex cursor-grab items-center gap-2 rounded-t-lg px-3 py-2">
            <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
            <h3 class="min-w-0 truncate text-sm font-semibold">{{ section.name }}</h3>
            <span class="text-muted-foreground ml-auto text-xs tabular-nums">{{ section.items.length }}</span>
          </div>
          <VueDraggable
            v-model="section.items"
            :group="ITEMS_GROUP"
            v-bind="DRAG_PROPS"
            class="flex min-h-10 flex-col gap-0.5 p-1.5"
          >
            <div
              v-for="item in section.items"
              :key="item.id"
              class="hover:bg-hover flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
              <span class="font-medium">{{ item.security.symbol }}</span>
              <span class="text-muted-foreground min-w-0 truncate text-xs">{{ item.security.name }}</span>
            </div>
          </VueDraggable>
        </section>
      </VueDraggable>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="close">{{ $t('common.actions.cancel') }}</Button>
        <Button :disabled="isPending" @click="save">{{ $t('common.actions.save') }}</Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
