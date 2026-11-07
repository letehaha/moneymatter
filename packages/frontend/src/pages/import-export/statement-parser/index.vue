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
        {{ $t('pages.statementParser.pageTitle') }}
      </h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.statementParser.pageDescription') }}
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
        <UploadExtractStep v-if="store.currentStepKey === 'upload'" />
        <AccountSelectionStep v-else-if="store.currentStepKey === 'account'" />
        <TransactionReviewStep v-else-if="store.currentStepKey === 'review'" />
        <ImportResultsStep v-else-if="store.currentStepKey === 'results'" />
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Card, CardContent } from '@/components/lib/ui/card';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { ROUTES_NAMES } from '@/routes';
import { type StatementParserStepKey, useStatementParserStore } from '@/stores/statement-parser';
import { ChevronLeftIcon } from '@lucide/vue';
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import WizardStepper from '@/components/common/wizard-stepper.vue';
import AccountSelectionStep from './components/account-selection-step.vue';
import ImportResultsStep from './components/import-results-step.vue';
import TransactionReviewStep from './components/transaction-review-step.vue';
import UploadExtractStep from './components/upload-extract-step.vue';

/** i18n key for each step label. */
const STEP_LABEL_KEYS: Record<StatementParserStepKey, string> = {
  upload: 'pages.statementParser.stepper.steps.upload',
  account: 'pages.statementParser.stepper.steps.account',
  review: 'pages.statementParser.stepper.steps.review',
  results: 'pages.statementParser.stepper.steps.results',
};

const store = useStatementParserStore();

/** Visible steps paired with their localized label keys for the shared stepper. */
const stepperSteps = computed(() =>
  store.visibleSteps.map((step) => ({ key: step.key, labelKey: STEP_LABEL_KEYS[step.key] })),
);

/** The stepper only emits keys for reachable (completed) steps, all valid StatementParserStepKeys. */
function onNavigate(key: string) {
  store.goToStep(key as StatementParserStepKey);
}

onMounted(() => {
  trackAnalyticsEvent({ event: 'import_opened', properties: { import_type: 'statement_parser' } });
});
</script>
