<template>
  <!-- Shared `csv-wizard` CSS container identifier (a plain CSS token, not CSV-specific
       semantics): the stepper + quick-action toolbar resolve their responsive variants
       against it, so both import wizards mark their root with the same name. -->
  <div class="@container/csv-wizard flex flex-col gap-0">
    <!-- Page header -->
    <div class="mb-6">
      <RouterLink
        :to="{ name: ROUTES_NAMES.settingsDataManagementImport }"
        class="text-muted-foreground hover:text-foreground mb-3 inline-flex w-fit items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeftIcon class="size-4" />
        {{ $t('settings.dataManagement.import.back') }}
      </RouterLink>
      <h2 class="mb-2 text-2xl font-semibold text-balance">
        {{ $t('pages.importExport.budgetBakersWalletImport.pageTitle') }}
      </h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.budgetBakersWalletImport.pageDescription') }}
      </p>
    </div>

    <!-- Numbered stepper. Container-query driven so it reacts to the content width, not the
         viewport (sidebar). Shared with the CSV wizard via the common container identifier. -->
    <WizardStepper
      class="mb-6"
      :steps="stepperSteps"
      :current-step-key="store.currentStepKey"
      :completed-step-keys="store.completedStepKeys"
      @navigate="onNavigate"
    />

    <!-- Active step panel -->
    <Card>
      <CardContent class="pt-2 sm:pt-6">
        <FileUploadStep v-if="store.currentStepKey === 'upload'" />
        <ResolveStep v-else-if="store.currentStepKey === 'resolve'" />
        <ReviewStep v-else-if="store.currentStepKey === 'review'" />
        <template v-else-if="store.currentStepKey === 'results'">
          <DoneStep v-if="store.progress?.status === 'completed'" />
          <ExecuteStep v-else />
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Card, CardContent } from '@/components/lib/ui/card';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { ROUTES_NAMES } from '@/routes';
import {
  type BudgetBakersWalletImportStepKey,
  useImportBudgetBakersWalletStore,
} from '@/stores/import-budget-bakers-wallet';
import { ChevronLeftIcon } from '@lucide/vue';
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import WizardStepper from '@/components/common/wizard-stepper.vue';
import DoneStep from './components/done-step.vue';
import ExecuteStep from './components/execute-step.vue';
import FileUploadStep from './components/file-upload-step.vue';
import ResolveStep from './components/resolve-step.vue';
import ReviewStep from './components/review-step.vue';

/** i18n key for each step label. */
const STEP_LABEL_KEYS: Record<BudgetBakersWalletImportStepKey, string> = {
  upload: 'pages.importExport.budgetBakersWalletImport.stepper.steps.upload',
  resolve: 'pages.importExport.budgetBakersWalletImport.stepper.steps.resolve',
  review: 'pages.importExport.budgetBakersWalletImport.stepper.steps.review',
  results: 'pages.importExport.budgetBakersWalletImport.stepper.steps.results',
};

const store = useImportBudgetBakersWalletStore();

/** Visible steps paired with their localized label keys for the shared stepper. */
const stepperSteps = computed(() =>
  store.visibleSteps.map((step) => ({ key: step.key, labelKey: STEP_LABEL_KEYS[step.key] })),
);

/** The stepper only emits keys for reachable (completed) steps, all valid BudgetBakersWalletImportStepKeys. */
function onNavigate(key: string) {
  store.goToStep(key as BudgetBakersWalletImportStepKey);
}

onMounted(() => {
  store.reset();
  trackAnalyticsEvent({ event: 'import_opened', properties: { import_type: 'budget-bakers-wallet' } });
});
</script>
