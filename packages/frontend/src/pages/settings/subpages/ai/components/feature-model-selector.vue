<template>
  <div class="space-y-4">
    <AiUsageMeterCard />

    <div>
      <h3 class="text-lg font-medium">{{ $t('settings.ai.features.title') }}</h3>
      <p class="text-muted-foreground text-sm">{{ $t('settings.ai.features.description') }}</p>
    </div>

    <div v-if="isLoadingFeatures" class="space-y-3">
      <div v-for="i in 4" :key="i" class="flex items-center gap-3 rounded-lg border p-4">
        <div class="bg-muted size-4 animate-pulse rounded" />
        <div class="flex-1 space-y-2">
          <div class="bg-muted h-4 w-40 animate-pulse rounded" />
          <div class="bg-muted/60 h-3 w-64 animate-pulse rounded" />
        </div>
      </div>
    </div>

    <div
      v-else-if="featuresUnknown"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center"
    >
      <TriangleAlertIcon class="text-destructive-text size-8" aria-hidden="true" />
      <p class="text-muted-foreground max-w-md text-sm">{{ $t('settings.ai.features.loadError') }}</p>
      <Button variant="outline" class="mt-2" :disabled="isRefetchingFeatures" @click="refetchFeatures()">
        <RotateCwIcon class="size-4" />
        {{ $t('common.actions.retry') }}
      </Button>
    </div>

    <div v-else class="space-y-3">
      <ModelSelectorCard v-for="status in featuresStatus" :key="status.feature" :feature-status="status">
        <template v-if="FEATURE_EXTRAS[status.feature]" #extras>
          <component :is="FEATURE_EXTRAS[status.feature]" />
        </template>
      </ModelSelectorCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { AI_FEATURE } from '@bt/shared/types';
import { RotateCwIcon, TriangleAlertIcon } from '@lucide/vue';
import type { Component } from 'vue';

import AiUsageMeterCard from './ai-usage-meter-card.vue';
import CustomInstructions from './features/custom-instructions.vue';
import ModelSelectorCard from './shared/model-selector-card.vue';

const FEATURE_EXTRAS: Partial<Record<AI_FEATURE, Component>> = {
  [AI_FEATURE.categorization]: CustomInstructions,
};

const { featuresStatus, isLoadingFeatures, featuresUnknown, isRefetchingFeatures, refetchFeatures } = useAiSettings();
</script>
