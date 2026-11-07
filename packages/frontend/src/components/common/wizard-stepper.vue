<script setup lang="ts">
/**
 * Numbered step header shared by the import wizards, the budget suggestion wizard and
 * the OAuth consent screen. Labels come in as localized `labelKey`s (the stepper holds
 * no copy). Non-current labels show once the stepper is LABELS_MIN_WIDTH_PX wide; below that only
 * numbers render and a tooltip carries the label. A host with few steps sets
 * `alwaysShowLabels`, since every label fits on one line there.
 */
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { CheckIcon, Undo2Icon } from '@lucide/vue';
import { useElementSize } from '@vueuse/core';
import { computed, useTemplateRef } from 'vue';

interface WizardStep {
  key: string;
  labelKey: string;
}

const props = defineProps<{
  steps: WizardStep[];
  currentStepKey: string;
  completedStepKeys: Set<string>;
  /** Drops the card frame, for hosts that are already a card (e.g. a dialog). */
  bare?: boolean;
  /** Labels every step at any width, not only the current one on a narrow stepper. */
  alwaysShowLabels?: boolean;
}>();

const emit = defineEmits<{
  navigate: [key: string];
}>();

const LABELS_MIN_WIDTH_PX = 768;

const root = useTemplateRef('root');
const { width } = useElementSize(root, undefined, { box: 'border-box' });
function isLabelVisible({ step }: { step: WizardStep }): boolean {
  return props.alwaysShowLabels || width.value >= LABELS_MIN_WIDTH_PX || props.currentStepKey === step.key;
}

const currentStepIndex = computed(() => props.steps.findIndex((step) => step.key === props.currentStepKey));

/**
 * Clickable only when completed AND at or behind the current step. A forward jump
 * is refused even for a step completed on an earlier run, because the data that
 * validated it may since have been cleared (e.g. an emptied account on the Map
 * step). Forward progress runs through the wizard's own re-validating advance.
 */
function isStepNavigable({ step, index }: { step: WizardStep; index: number }): boolean {
  return props.completedStepKeys.has(step.key) && index <= currentStepIndex.value;
}

function onStepClick({ step }: { step: WizardStep }) {
  emit('navigate', step.key);
}
</script>

<template>
  <div ref="root" :class="!bare && 'bg-card rounded-xl border px-4 py-3'">
    <div class="flex items-center">
      <template v-for="(step, index) in steps" :key="step.key">
        <!-- Connector between steps; fills once the step is reached -->
        <div
          v-if="index > 0"
          class="mx-2 h-0.5 flex-1 rounded-full transition-colors duration-300"
          :class="completedStepKeys.has(step.key) || currentStepKey === step.key ? 'bg-primary' : 'bg-border'"
        />

        <ResponsiveTooltip :content="$t(step.labelKey)" :disabled="isLabelVisible({ step })">
          <!-- Span catches pointer events for the tooltip: a disabled <button> swallows them. -->
          <span
            class="inline-flex shrink-0"
            :class="
              isStepNavigable({ step, index }) || currentStepKey === step.key ? 'cursor-default' : 'cursor-not-allowed'
            "
          >
            <UiButton
              variant="ghost"
              type="button"
              class="h-auto shrink-0 gap-2 rounded-md p-0 transition-colors hover:bg-transparent"
              :class="isStepNavigable({ step, index }) && currentStepKey !== step.key && 'group/step'"
              :disabled="!isStepNavigable({ step, index }) && currentStepKey !== step.key"
              :aria-current="currentStepKey === step.key ? 'step' : undefined"
              :aria-label="$t(step.labelKey)"
              @click="isStepNavigable({ step, index }) ? onStepClick({ step }) : undefined"
            >
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-300"
                :class="
                  completedStepKeys.has(step.key) || currentStepKey === step.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground bg-transparent'
                "
              >
                <template v-if="completedStepKeys.has(step.key)">
                  <CheckIcon class="size-3.5 group-hover/step:hidden group-focus-visible/step:hidden" />
                  <Undo2Icon class="hidden size-3.5 group-hover/step:block group-focus-visible/step:block" />
                </template>
                <span v-else>{{ index + 1 }}</span>
              </span>
              <span
                v-if="isLabelVisible({ step })"
                class="text-sm whitespace-nowrap"
                :class="
                  currentStepKey === step.key
                    ? 'text-foreground font-semibold'
                    : completedStepKeys.has(step.key)
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground font-medium'
                "
              >
                {{ $t(step.labelKey) }}
              </span>
            </UiButton>
          </span>
        </ResponsiveTooltip>
      </template>
    </div>
  </div>
</template>
