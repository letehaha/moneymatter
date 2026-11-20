<template>
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
        {{ $t('pages.importExport.csvImport.pageTitle') }}
      </h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.csvImport.pageDescription') }}
      </p>
    </div>

    <WizardStepper
      class="mb-6"
      :steps="stepperSteps"
      :current-step-key="store.currentStepKey"
      :completed-step-keys="store.completedStepKeys"
      @navigate="onNavigate"
    />

    <!-- Active step panel -->
    <div class="min-w-0">
      <FileUploadStep v-if="store.currentStepKey === 'upload'" />
      <ColumnMappingStep v-else-if="store.currentStepKey === 'map'" />
      <ResolveValuesStep v-else-if="store.currentStepKey === 'resolve-accounts'" section="accounts" />
      <ResolveValuesStep v-else-if="store.currentStepKey === 'resolve-categories'" section="categories" />
      <ReviewDuplicatesStep v-else-if="store.currentStepKey === 'review'" />
      <template v-else-if="store.currentStepKey === 'results'">
        <ImportResultsStep v-if="store.progress?.status === 'completed'" />
        <ImportExecuteStep v-else />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ROUTES_NAMES } from '@/routes';
import { type ImportStepKey, useImportExportStore } from '@/stores/import-export';
import { ChevronLeftIcon } from '@lucide/vue';
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import WizardStepper from '@/components/common/wizard-stepper.vue';
import ColumnMappingStep from './components/column-mapping-step/index.vue';
import FileUploadStep from './components/file-upload-step/index.vue';
import ImportExecuteStep from './components/import-execute-step/index.vue';
import ImportResultsStep from './components/import-results-step/index.vue';
import ResolveValuesStep from './components/resolve-values-step/index.vue';
import ReviewDuplicatesStep from './components/review-duplicates-step/index.vue';

/** i18n key for each step label. */
const STEP_LABEL_KEYS: Record<ImportStepKey, string> = {
  upload: 'pages.importExport.csvImport.stepper.steps.upload',
  map: 'pages.importExport.csvImport.stepper.steps.map',
  'resolve-accounts': 'pages.importExport.csvImport.stepper.steps.resolveAccounts',
  'resolve-categories': 'pages.importExport.csvImport.stepper.steps.resolveCategories',
  review: 'pages.importExport.csvImport.stepper.steps.review',
  results: 'pages.importExport.csvImport.stepper.steps.results',
};

const store = useImportExportStore();

/** Visible steps paired with their localized label keys for the shared stepper. */
const stepperSteps = computed(() =>
  store.visibleSteps.map((step) => ({ key: step.key, labelKey: STEP_LABEL_KEYS[step.key] })),
);

/** The stepper only emits keys for reachable (visible) steps, all valid ImportStepKeys. */
function onNavigate(key: string) {
  store.goToStep(key as ImportStepKey);
}

onMounted(() => {
  store.reset();
});
</script>
