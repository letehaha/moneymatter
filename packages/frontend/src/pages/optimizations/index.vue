<script setup lang="ts">
import { Card } from '@/components/lib/ui/card';
import { useTransactionAutomations } from '@/composable/data-queries/transaction-automations';
import ApplyToHistoryDialog from '@/pages/automations/components/apply-to-history-dialog.vue';
import { ROUTES_NAMES } from '@/routes';
import { ArrowRightLeftIcon, GitMergeIcon, HistoryIcon, SparklesIcon } from '@lucide/vue';
import { type Component, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const { list: automations, isLoading, isError } = useTransactionAutomations();

const isApplyOpen = ref(false);

interface OptimizationCard {
  icon: Component;
  titleKey: string;
  descriptionKey: string;
  onClick: () => void;
}

const optimizations: OptimizationCard[] = [
  {
    icon: ArrowRightLeftIcon,
    titleKey: 'optimizations.cards.transfers.title',
    descriptionKey: 'optimizations.cards.transfers.description',
    onClick: () => {
      router.push({ name: ROUTES_NAMES.optimizationsTransfers });
    },
  },
  {
    icon: SparklesIcon,
    titleKey: 'optimizations.cards.aiCategorization.title',
    descriptionKey: 'optimizations.cards.aiCategorization.description',
    onClick: () => {
      router.push({ name: ROUTES_NAMES.optimizationsAiCategorization });
    },
  },
  {
    icon: GitMergeIcon,
    titleKey: 'optimizations.cards.reconciliation.title',
    descriptionKey: 'optimizations.cards.reconciliation.description',
    onClick: () => {
      router.push({ name: ROUTES_NAMES.optimizationsReconciliation });
    },
  },
  {
    icon: HistoryIcon,
    titleKey: 'optimizations.cards.applyRules.title',
    descriptionKey: 'optimizations.cards.applyRules.description',
    onClick: () => (isApplyOpen.value = true),
  },
];
</script>

<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">
        {{ $t('optimizations.title') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">
        {{ $t('optimizations.landingDescription') }}
      </p>
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(385px,1fr))] gap-4">
      <Card
        v-for="item in optimizations"
        :key="item.titleKey"
        class="hover:border-primary/50 focus-visible:ring-ring cursor-pointer p-5 transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
        role="button"
        tabindex="0"
        @click="item.onClick()"
        @keydown.enter.self.prevent="item.onClick()"
        @keydown.space.self.prevent="item.onClick()"
      >
        <div class="flex items-start gap-4">
          <div class="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-lg">
            <component :is="item.icon" class="text-primary-text size-5" />
          </div>
          <div class="min-w-0">
            <h3 class="font-semibold">{{ $t(item.titleKey) }}</h3>
            <p class="text-muted-foreground mt-1 text-sm">
              {{ $t(item.descriptionKey) }}
            </p>
          </div>
        </div>
      </Card>
    </div>

    <ApplyToHistoryDialog
      v-if="isApplyOpen"
      v-model:open="isApplyOpen"
      :rule="null"
      :rules="automations"
      :rules-loading="isLoading"
      :rules-error="isError"
    />
  </div>
</template>
