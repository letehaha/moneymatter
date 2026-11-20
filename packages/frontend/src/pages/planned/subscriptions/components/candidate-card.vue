<script setup lang="ts">
import type { SubscriptionCandidate } from '@/api/subscription-candidates';
import Button from '@/components/lib/ui/button/Button.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { LinkIcon, PlusIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import BrandLogo from '@/components/common/brand-logo.vue';

import { formatFrequency } from '../utils';

const props = defineProps<{
  candidate: SubscriptionCandidate;
  isAccepting?: boolean;
  isDismissing?: boolean;
  isLinking?: boolean;
}>();

const emit = defineEmits<{
  accept: [candidate: SubscriptionCandidate];
  dismiss: [candidate: SubscriptionCandidate];
  link: [candidate: SubscriptionCandidate];
  'view-transactions': [transactionIds: string[]];
}>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const CONFIDENCE_SEGMENTS = 5;
const LIKELY_MATCH_THRESHOLD = 0.7;
const POSSIBLE_MATCH_THRESHOLD = 0.4;

const confidence = computed(() => {
  const score = props.candidate.confidenceScore;
  const activeSegments = Math.min(CONFIDENCE_SEGMENTS, Math.max(1, Math.round(score * CONFIDENCE_SEGMENTS)));

  if (score >= LIKELY_MATCH_THRESHOLD) {
    return {
      label: t('planned.subscriptions.candidates.confidence.likely'),
      segmentClass: 'bg-success-text',
      activeSegments,
    };
  }
  if (score >= POSSIBLE_MATCH_THRESHOLD) {
    return {
      label: t('planned.subscriptions.candidates.confidence.possible'),
      segmentClass: 'bg-warning-text',
      activeSegments,
    };
  }
  return {
    label: t('planned.subscriptions.candidates.confidence.weak'),
    segmentClass: 'bg-muted-foreground',
    activeSegments,
  };
});
</script>

<template>
  <div class="border-border bg-card rounded-xl border p-4">
    <div class="flex items-start gap-3">
      <!-- :domain="null" – candidates have no resolved logo yet; they become subscriptions on accept -->
      <BrandLogo :domain="null" :name="candidate.suggestedName" class="size-10" />
      <div class="min-w-0 flex-1">
        <h4 class="truncate text-sm font-medium">{{ candidate.suggestedName }}</h4>
        <div class="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs font-medium">
          <span class="flex gap-0.5" aria-hidden="true">
            <span
              v-for="i in CONFIDENCE_SEGMENTS"
              :key="i"
              :class="
                cn('h-1 w-2.5 rounded-full', i <= confidence.activeSegments ? confidence.segmentClass : 'bg-secondary')
              "
            />
          </span>
          {{ confidence.label }}
        </div>
      </div>
      <div class="shrink-0 text-right">
        <p class="text-amount text-base leading-tight">
          {{ formatAmountByCurrencyCode(candidate.averageAmount, candidate.currencyCode) }}
        </p>
        <p class="text-muted-foreground mt-0.5 text-xs">
          {{
            formatFrequency({
              frequency: candidate.detectedFrequency,
              intervalUnit: candidate.detectedIntervalUnit,
              intervalCount: candidate.detectedIntervalCount,
              t,
            })
          }}
        </p>
      </div>
    </div>

    <!-- Possible match indicator -->
    <div
      v-if="candidate.possibleMatch"
      class="bg-primary/10 text-primary-text mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
    >
      <LinkIcon class="size-3 shrink-0" />
      {{ t('planned.subscriptions.candidates.possibleMatch', { name: candidate.possibleMatch.name }) }}
    </div>

    <div class="border-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <button
        v-if="candidate.sampleTransactionIds.length"
        class="text-muted-foreground hover:text-foreground min-w-0 cursor-pointer truncate text-xs underline decoration-dotted underline-offset-2"
        :title="t('planned.subscriptions.candidates.viewTransactions')"
        @click.stop="emit('view-transactions', candidate.sampleTransactionIds)"
      >
        {{ t('planned.subscriptions.candidates.basedOnTransactions', { count: candidate.occurrenceCount }) }}
      </button>
      <span v-else class="text-muted-foreground min-w-0 truncate text-xs">
        {{ t('planned.subscriptions.candidates.basedOnTransactions', { count: candidate.occurrenceCount }) }}
      </span>

      <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          :disabled="isAccepting || isDismissing || isLinking"
          @click="emit('dismiss', candidate)"
        >
          {{ t('planned.subscriptions.candidates.dismiss') }}
        </Button>
        <!-- Link to existing (shown when there's a possible match) -->
        <Button
          v-if="candidate.possibleMatch"
          size="sm"
          :disabled="isAccepting || isDismissing || isLinking"
          @click="emit('link', candidate)"
        >
          <LinkIcon class="size-3.5" />
          {{ t('planned.subscriptions.candidates.linkToExisting') }}
        </Button>
        <Button
          :variant="candidate.possibleMatch ? 'outline' : 'default'"
          size="sm"
          :disabled="isAccepting || isDismissing || isLinking"
          @click="emit('accept', candidate)"
        >
          <PlusIcon class="size-3.5" />
          {{ t('planned.subscriptions.candidates.add') }}
        </Button>
      </div>
    </div>
  </div>
</template>
