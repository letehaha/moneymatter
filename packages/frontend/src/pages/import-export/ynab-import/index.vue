<template>
  <!-- Shared `csv-wizard` CSS container identifier (a plain CSS token, not CSV-specific
       semantics): its step components resolve their responsive variants against it, so every
       import wizard marks its root with the same name. -->
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
        {{ $t('pages.importExport.ynabImport.pageTitle') }}
      </h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.ynabImport.pageDescription') }}
      </p>
    </div>

    <!-- Numbered stepper. Container-query driven so it reacts to the content width, not the
         viewport (sidebar). Shared with the CSV/Wallet wizards via the common container identifier. -->
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
        <PreviewStep v-else-if="store.currentStepKey === 'preview'" />
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
import { type YnabImportStepKey, useImportYnabStore } from '@/stores/import-ynab';
import { ChevronLeftIcon } from '@lucide/vue';
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import WizardStepper from '@/components/common/wizard-stepper.vue';
import DoneStep from './components/done-step.vue';
import ExecuteStep from './components/execute-step.vue';
import FileUploadStep from './components/file-upload-step.vue';
import PreviewStep from './components/preview-step.vue';

/** i18n key for each step label. */
const STEP_LABEL_KEYS: Record<YnabImportStepKey, string> = {
  upload: 'pages.importExport.ynabImport.stepper.steps.upload',
  preview: 'pages.importExport.ynabImport.stepper.steps.preview',
  results: 'pages.importExport.ynabImport.stepper.steps.results',
};

const store = useImportYnabStore();

/** Visible steps paired with their localized label keys for the shared stepper. */
const stepperSteps = computed(() =>
  store.visibleSteps.map((step) => ({ key: step.key, labelKey: STEP_LABEL_KEYS[step.key] })),
);

/** The stepper only emits keys for reachable (completed) steps, all valid YnabImportStepKeys. */
function onNavigate(key: string) {
  store.goToStep(key as YnabImportStepKey);
}

onMounted(() => {
  trackAnalyticsEvent({ event: 'import_opened', properties: { import_type: 'ynab' } });
});
</script>
