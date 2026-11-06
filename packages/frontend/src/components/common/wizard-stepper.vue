<script setup lang="ts">
/**
 * Numbered step header shared by the import wizards, the budget suggestion wizard and
 * the OAuth consent screen. Labels come in as localized `labelKey`s (the stepper holds
 * no copy). Layout is container-query driven; hosts tag their wrapper with the
 * container name `csv-wizard` because Tailwind can't interpolate a name into the
 * `@3xl/<name>` variant used below. A host with few steps sets `alwaysShowLabels`
 * instead, since every label fits on one line there.
 */
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { cn } from '@/lib/utils';
import { CheckIcon } from '@lucide/vue';
import { computed } from 'vue';

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
  /** Labels every step at any width, not only the current one below `@3xl`. */
  alwaysShowLabels?: boolean;
}>();

const emit = defineEmits<{
  navigate: [key: string];
}>();

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
  <div :class="!bare && 'bg-card rounded-xl border px-4 py-3'">
    <div class="flex items-center">
      <template v-for="(step, index) in steps" :key="step.key">
        <!-- Connector between steps; fills once the step is reached -->
        <div
          v-if="index > 0"
          class="mx-2 h-0.5 flex-1 rounded-full transition-colors duration-300"
          :class="completedStepKeys.has(step.key) || currentStepKey === step.key ? 'bg-primary' : 'bg-border'"
        />

        <ResponsiveTooltip :content="$t(step.labelKey)">
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
              class="h-auto shrink-0 gap-2 rounded-md p-0 transition-colors"
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
                <CheckIcon v-if="completedStepKeys.has(step.key)" class="size-3.5" />
                <span v-else>{{ index + 1 }}</span>
              </span>
              <!-- Current step always labelled; others only at @3xl, keeping narrow rows one line -->
              <span
                class="text-sm whitespace-nowrap"
                :class="
                  cn(
                    currentStepKey === step.key
                      ? 'text-foreground inline font-semibold'
                      : completedStepKeys.has(step.key)
                        ? 'text-foreground hidden font-medium @3xl/csv-wizard:inline'
                        : 'text-muted-foreground hidden font-medium @3xl/csv-wizard:inline',
                    alwaysShowLabels && 'inline',
                  )
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
