<script setup lang="ts">
import { cn } from '@/lib/utils';
import { X } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui';
import { type HTMLAttributes, computed } from 'vue';

const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>();
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      :class="[
        'fixed inset-0 z-(--z-dialog) grid place-items-center overflow-y-auto bg-black/80',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      ]"
    >
      <DialogContent
        :class="
          cn(
            'border-border bg-dialog relative z-(--z-dialog) my-8 flex w-full max-w-lg flex-col gap-4 border p-6 shadow-lg duration-200 sm:rounded-lg md:w-full',
            props.class,
          )
        "
        v-bind="forwarded"
        @pointer-down-outside="
          (event) => {
            const originalEvent = event.detail.originalEvent;
            const target = originalEvent.target as HTMLElement;
            if (originalEvent.offsetX > target.clientWidth || originalEvent.offsetY > target.clientHeight) {
              event.preventDefault();
            }
          }
        "
      >
        <slot />

        <DialogClose class="hover:bg-hover absolute top-3 right-3 rounded-md p-0.5 transition-colors">
          <X class="size-4" />
          <span class="sr-only">{{ t('common.ui.close') }}</span>
        </DialogClose>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>
