<template>
  <Toaster
    position="bottom-right"
    :theme="theme"
    :expand="isStackExpanded"
    :visible-toasts="MAX_VISIBLE_TOASTS"
    :toast-options="toastOptions"
    :container-aria-label="t('notifications.containerAriaLabel')"
    :style="{ '--width': `${TOAST_WIDTH_PX}px`, '--toast-pulse-duration': `${PULSE_DURATION_MS}ms` }"
    close-button
  >
    <template #success-icon>
      <CircleCheckIcon class="text-success-text size-5" />
    </template>
    <template #error-icon>
      <CircleXIcon class="text-destructive-text size-5" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="text-warning-text size-5" />
    </template>
    <template #info-icon>
      <InfoIcon class="text-primary-text size-5" />
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Toaster>
</template>

<script setup lang="ts">
import 'vue-sonner/style.css';

import { Themes, currentTheme } from '@/common/utils/color-theme';
import { buttonVariants } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import { CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon, XIcon } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Toaster, type ToasterProps } from 'vue-sonner';

import { PULSE_DURATION_MS } from './toast-pulse';
import { createToastStackMotion } from './toast-stack-motion';
import { holdToastTimers, releaseToastTimers } from './toast-timers';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_WIDTH_PX = 368;
const STACK_HOVER_GRACE_PX = 12;
const LIST_SELECTOR = 'ol[data-sonner-toaster]';

const { t } = useI18n();

const toastOptions = computed<ToasterProps['toastOptions']>(() => ({
  unstyled: true,
  closeButtonAriaLabel: t('notifications.closeToast'),
  classes: {
    toast: 'relative flex w-full items-start gap-3 rounded-xl border border-border bg-popover p-4 pr-10 shadow-lg',
    icon: 'flex size-5 shrink-0 items-center justify-center',
    content: 'flex min-w-0 flex-1 flex-col gap-1',
    title: 'line-clamp-4 text-sm leading-snug font-medium text-foreground',
    description: 'line-clamp-4 text-sm leading-snug',
    closeButton: 'absolute top-2.5 right-2.5 flex size-6 cursor-pointer items-center justify-center rounded-md',
    actionButton: cn(buttonVariants({ variant: 'secondary' }), 'h-8 shrink-0 cursor-pointer self-center px-3 text-xs'),
  },
}));

const theme = computed<ToasterProps['theme']>(() => (currentTheme.value === Themes.dark ? 'dark' : 'light'));

const isStackExpanded = ref(false);
const toasterListEl = ref<HTMLElement | null>(null);
let stackEmptyObserver: MutationObserver | null = null;
let touchHoldPointerId: number | null = null;
let isPointerHoldingStack = false;
let isFocusHoldingStack = false;
let focusLeaveTimeout: ReturnType<typeof setTimeout> | null = null;

// Never use the <ol>'s own rect here: every toast is absolutely positioned, so the list box
// measures zero height.
const getStackArea = () => {
  const list = toasterListEl.value;
  if (!list?.isConnected) return null;

  const toasts = list.querySelectorAll<HTMLElement>(
    '[data-sonner-toast]:not([data-visible="false"]):not([data-removed="true"])',
  );
  if (!toasts.length) return null;

  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  toasts.forEach((toastEl) => {
    const rect = toastEl.getBoundingClientRect();
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  });

  return { top, left, right, bottom };
};

const isPointerInStackArea = ({ x, y }: { x: number; y: number }) => {
  const area = getStackArea();
  if (!area) return false;

  return (
    x >= area.left - STACK_HOVER_GRACE_PX &&
    x <= area.right + STACK_HOVER_GRACE_PX &&
    y >= area.top - STACK_HOVER_GRACE_PX &&
    y <= area.bottom + STACK_HOVER_GRACE_PX
  );
};

const getLiveToasterList = () => {
  const tracked = toasterListEl.value;
  if (tracked?.isConnected) return tracked;

  return document.querySelector<HTMLElement>(LIST_SELECTOR);
};

const stackMotion = createToastStackMotion({
  getList: getLiveToasterList,
  getIsExpanded: () => isStackExpanded.value,
});

const isFocusInsideStack = () => {
  const active = document.activeElement;
  return active instanceof Element && Boolean(active.closest(LIST_SELECTOR));
};

// A hold from any source outranks a release from another: the timers stay frozen until nothing
// is holding them, and then every toast restarts from its full duration.
const releaseTimersIfIdle = () => {
  if (isStackExpanded.value || touchHoldPointerId !== null || document.hidden || isFocusInsideStack()) return;

  releaseToastTimers();
};

const collapseStack = () => {
  isPointerHoldingStack = false;
  isFocusHoldingStack = false;
  document.removeEventListener('pointermove', handleStackPointerMove);
  isStackExpanded.value = false;
  stackMotion.syncStack();
  releaseTimersIfIdle();
};

const releasePointerHold = () => {
  isPointerHoldingStack = false;
  document.removeEventListener('pointermove', handleStackPointerMove);
  if (!isFocusInsideStack()) collapseStack();
};

const releaseFocusHold = () => {
  if (isFocusInsideStack()) return;

  isFocusHoldingStack = false;
  if (!isPointerHoldingStack) collapseStack();
};

function handleStackPointerMove(event: PointerEvent) {
  if (!isPointerInStackArea({ x: event.clientX, y: event.clientY })) releasePointerHold();
}

// Collapse once the last toast leaves the DOM, otherwise the next batch mounts already fanned out.
// The attribute flips drive the stack motion compensation, which only ever runs while hovering.
const observeStackEmptied = ({ list }: { list: HTMLElement }) => {
  stackEmptyObserver?.disconnect();
  stackEmptyObserver?.observe(list, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-removed', 'data-expanded', 'style'],
  });
};

const trackToasterList = ({ list }: { list: HTMLElement }) => {
  if (toasterListEl.value !== list) observeStackEmptied({ list });
  toasterListEl.value = list;
};

const handleDocumentPointerOver = (event: PointerEvent) => {
  // A touch tap fires pointerover with no matching pointerout, so tracking it pins the stack open forever.
  if (event.pointerType === 'touch') return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const list = target.closest<HTMLElement>(LIST_SELECTOR);
  if (!list) return;

  const isNewList = toasterListEl.value !== list;
  trackToasterList({ list });
  if (isPointerHoldingStack && !isNewList) return;

  isPointerHoldingStack = true;
  isStackExpanded.value = true;
  holdToastTimers();
  document.addEventListener('pointermove', handleStackPointerMove);
};

// Sonner's Alt+T hotkey and a plain Tab both land focus in the list; without this the timers keep
// running and the clamped text never reveals for anyone not using a pointer.
const handleDocumentFocusIn = (event: FocusEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const list = target.closest<HTMLElement>(LIST_SELECTOR);
  if (!list) return;

  trackToasterList({ list });
  isFocusHoldingStack = true;
  isStackExpanded.value = true;
  holdToastTimers();
  stackMotion.handlePointerOver({ event });
};

// Keyed on the flag rather than the event target: dismissing a focused toast detaches it before
// focusout fires, and a detached target no longer resolves to the list.
const handleDocumentFocusOut = (event: FocusEvent) => {
  if (!isFocusHoldingStack) return;

  const next = event.relatedTarget;
  if (next instanceof Element && next.closest(LIST_SELECTOR)) return;

  // A null relatedTarget covers both a real leave and a window blur, and focusout runs before the
  // next element takes focus, so only a deferred read of activeElement can tell them apart.
  if (focusLeaveTimeout !== null) clearTimeout(focusLeaveTimeout);
  focusLeaveTimeout = setTimeout(() => {
    focusLeaveTimeout = null;
    releaseFocusHold();
  });
};

// Touch never produces the pointerover the area tracker runs on, so a tap-and-hold on the stack
// is the only signal that the user is reading it.
const handleDocumentPointerDown = (event: PointerEvent) => {
  if (event.pointerType !== 'touch' || touchHoldPointerId !== null) return;

  const target = event.target;
  if (!(target instanceof Element) || !target.closest(LIST_SELECTOR)) return;

  touchHoldPointerId = event.pointerId;
  holdToastTimers();
};

const handleDocumentPointerRelease = (event: PointerEvent) => {
  if (touchHoldPointerId !== event.pointerId) return;

  touchHoldPointerId = null;
  releaseTimersIfIdle();
};

const handleDocumentVisibilityChange = () => {
  if (document.hidden) {
    holdToastTimers();
    return;
  }

  releaseTimersIfIdle();
};

const handleStackHoverChange = (event: PointerEvent) => stackMotion.handlePointerOver({ event });

// Re-test the coordinates instead of collapsing on any null relatedTarget: that also fires when
// a toast grabs pointer capture mid-swipe, which would cancel the swipe.
const handleDocumentPointerOut = (event: PointerEvent) => {
  if (event.relatedTarget !== null || !isStackExpanded.value) return;
  if (!isPointerInStackArea({ x: event.clientX, y: event.clientY })) releasePointerHold();
};

onMounted(() => {
  stackEmptyObserver = new MutationObserver((records) => {
    stackMotion.syncStack();

    const stackChanged = records.some(
      (record) =>
        record.type === 'childList' && record.target instanceof Element && record.target.matches(LIST_SELECTOR),
    );
    if (!stackChanged) return;

    if (!toasterListEl.value?.querySelector('li[data-sonner-toast]')) collapseStack();
  });

  // `handleStackHoverChange` must come after `handleDocumentPointerOver` so the expanded flag it
  // reads is already up to date.
  document.addEventListener('pointerover', handleDocumentPointerOver);
  document.addEventListener('pointerover', handleStackHoverChange);
  document.addEventListener('pointerout', handleDocumentPointerOut);
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('pointerup', handleDocumentPointerRelease);
  document.addEventListener('pointercancel', handleDocumentPointerRelease);
  document.addEventListener('focusin', handleDocumentFocusIn);
  document.addEventListener('focusout', handleDocumentFocusOut);
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
  document.documentElement.addEventListener('mouseleave', releasePointerHold);

  // Booting in a background tab never fires visibilitychange, so the hold has to be taken here.
  if (document.hidden) holdToastTimers();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerover', handleDocumentPointerOver);
  document.removeEventListener('pointerover', handleStackHoverChange);
  document.removeEventListener('pointerout', handleDocumentPointerOut);
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  document.removeEventListener('pointerup', handleDocumentPointerRelease);
  document.removeEventListener('pointercancel', handleDocumentPointerRelease);
  document.removeEventListener('focusin', handleDocumentFocusIn);
  document.removeEventListener('focusout', handleDocumentFocusOut);
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
  document.documentElement.removeEventListener('mouseleave', releasePointerHold);
  document.removeEventListener('pointermove', handleStackPointerMove);
  if (focusLeaveTimeout !== null) clearTimeout(focusLeaveTimeout);
  focusLeaveTimeout = null;
  stackMotion.reset();
  touchHoldPointerId = null;
  isPointerHoldingStack = false;
  isFocusHoldingStack = false;
  // Nothing is left to lift a hold once the listeners are gone, so drop it unconditionally.
  releaseToastTimers();
  stackEmptyObserver?.disconnect();
  stackEmptyObserver = null;
});
</script>

<style>
button[data-action].toast-action-icon-undo::before {
  content: '';
  width: 0.875rem;
  height: 0.875rem;
  background-color: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 14 4 9l5-5'/%3E%3Cpath d='M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'/%3E%3C/svg%3E")
    center / contain no-repeat;
}

ol[data-sonner-toaster] {
  z-index: var(--z-notifications);
  font-family: inherit;
  interpolate-size: allow-keywords;
}

li[data-sonner-toast] {
  transition:
    transform 300ms,
    opacity 300ms,
    height 300ms,
    box-shadow 200ms;
}

li[data-sonner-toast] > * {
  transition: opacity 300ms;
}

/* Overriding --y rather than `transform` keeps sonner's swipe translations composing on top.
   `[data-sonner-theme]` only adds specificity: sonner's exit rule for a removed non-front toast
   carries five attributes, and losing to it would fly the toast a card height out of its slot. */
ol[data-sonner-toaster][data-sonner-theme] li[data-sonner-toast][data-mounted='true'][data-expanded='true'] {
  --y: translateY(calc(var(--lift) * (var(--offset) + var(--push-up, 0px) - var(--removed-lead, 0px))));
}

/* The slot has to close without leaving a hole, so the exit is instant rather than animated. */
ol[data-sonner-toaster] li[data-sonner-toast][data-removed='true'][data-expanded='true'] {
  opacity: 0;
  pointer-events: none;
  transition: none;
}

/* Held while the stack re-flows around a dismissal: transform and height must apply un-animated. */
ol[data-sonner-toaster][data-removal-snap] li[data-sonner-toast] {
  transition:
    opacity 300ms,
    box-shadow 200ms;
}

li[data-sonner-toast][data-type='success'] {
  --toast-accent: var(--success-text);
  border-color: color-mix(in oklab, var(--success-text) 20%, transparent);
}

li[data-sonner-toast][data-type='warning'] {
  --toast-accent: var(--warning-text);
  border-color: color-mix(in oklab, var(--warning-text) 20%, transparent);
}

li[data-sonner-toast][data-type='error'] {
  --toast-accent: var(--destructive-text);
  border-color: color-mix(in oklab, var(--destructive-text) 20%, transparent);
}

li[data-sonner-toast][data-type='info'] {
  --toast-accent: var(--primary);
  border-color: color-mix(in oklab, var(--primary) 20%, transparent);
}

/* Re-raising a live notification replaces it in place, so it flashes a ring to announce itself.
   The ring rides a pseudo-element to leave the toast's own box-shadow alone. */
li[data-sonner-toast][data-pulse='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  /* Sonner sizes this same pseudo-element to the gap above an expanded toast; without dropping its
     width and height the ring would trace that strip instead of the card. */
  width: auto;
  height: auto;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    0 0 0 2px color-mix(in oklab, var(--toast-accent, var(--primary)) 55%, transparent),
    0 0 12px 2px color-mix(in oklab, var(--toast-accent, var(--primary)) 35%, transparent);
  animation: toast-pulse-ring var(--toast-pulse-duration, 300ms) ease-out both;
}

@keyframes toast-pulse-ring {
  0% {
    opacity: 0;
  }

  25% {
    opacity: 0.5;
  }

  100% {
    opacity: 0;
  }
}

li[data-sonner-toast][data-expanded='false'][data-front='false'] > * {
  opacity: 0;
}

/* Un-clamping title and description needs an auto height; `interpolate-size` makes that height animate. */
li[data-sonner-toast][data-mounted='true'][data-expanded='true']:hover,
li[data-sonner-toast][data-mounted='true'][data-expanded='true']:focus-within {
  height: auto;
}

/* Matches the four-line clamp of the utility classes, but as a length so the reveal can animate. */
li[data-sonner-toast] [data-title],
li[data-sonner-toast] [data-description] {
  max-height: 4lh;
  overflow: hidden;
  transition: max-height 300ms;
  /* Restoring the line count collapses the content to four lines outright, which would leave
     max-height nothing to constrain; step-end defers it until max-height has finished shrinking.
     The plain declaration above stands in where discrete transitions are unsupported. */
  transition:
    max-height 300ms,
    -webkit-line-clamp 300ms step-end allow-discrete,
    line-clamp 300ms step-end allow-discrete;
}

/* The clamp utility keeps its -webkit-box; dropping only the line count reveals the rest of the
   text. Naming max-height alone keeps the reveal instant while the collapse stays deferred. */
li[data-sonner-toast]:hover [data-title],
li[data-sonner-toast]:hover [data-description],
li[data-sonner-toast]:focus-within [data-title],
li[data-sonner-toast]:focus-within [data-description] {
  max-height: max-content;
  -webkit-line-clamp: unset;
  line-clamp: unset;
  transition: max-height 300ms;
}

/* Forced end states the hover-expansion measurement reads, both outranking the :hover rule above.
   They stay inside the content box: a forced state on the toast itself would suppress the transform
   and height transitions the same recalculation starts when the stack fans out. */
ol[data-sonner-toaster] li[data-sonner-toast][data-measure-clamped] [data-title],
ol[data-sonner-toaster] li[data-sonner-toast][data-measure-clamped] [data-description] {
  max-height: 4lh;
  transition: none;
}

ol[data-sonner-toaster] li[data-sonner-toast][data-measure-expanded] [data-title],
ol[data-sonner-toaster] li[data-sonner-toast][data-measure-expanded] [data-description] {
  max-height: max-content;
  -webkit-line-clamp: unset;
  line-clamp: unset;
  transition: none;
}

@media (prefers-reduced-motion) {
  ol[data-sonner-toaster] li[data-sonner-toast] [data-title],
  ol[data-sonner-toaster] li[data-sonner-toast] [data-description] {
    transition: none;
  }
}

li[data-sonner-toast]:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
}

/* Outranks sonner's own dark-theme rules, which are unlayered and therefore beat Tailwind utilities. */
ol[data-sonner-toaster] li[data-sonner-toast] [data-description] {
  color: var(--muted-foreground);
}

ol[data-sonner-toaster][data-sonner-theme] li[data-sonner-toast] [data-close-button] {
  background: transparent;
  border: none;
  color: var(--muted-foreground);
  transition:
    background 200ms,
    color 200ms,
    opacity 300ms;
}

ol[data-sonner-toaster][data-sonner-theme] li[data-sonner-toast] [data-close-button]:hover {
  background: var(--accent);
  color: var(--foreground);
}
</style>
