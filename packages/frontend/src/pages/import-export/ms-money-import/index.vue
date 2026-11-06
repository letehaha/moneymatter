<template>
  <!-- Shared `csv-wizard` CSS container identifier (a plain CSS token, not CSV-specific
       semantics): its step components resolve their responsive variants
       against it, so every import wizard marks its root with the same name. -->
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
      <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 class="text-2xl font-semibold text-balance">
          {{ $t('pages.importExport.msMoneyImport.pageTitle') }}
        </h2>

        <ResourceLeaseBadge
          v-if="isLeaseHeld"
          :state="leaseState"
          :formatted-remaining="formattedRemaining"
          :ms-remaining="msRemaining"
          :is-capped="isCapped"
          :resource-label="$t('pages.importExport.msMoneyImport.leaseResourceLabel')"
        />
      </div>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.msMoneyImport.pageDescription') }}
      </p>
    </div>

    <Callout
      v-if="isLeaseHeld && isExpired"
      variant="destructive"
      role="alert"
      class="mb-6"
      :title="$t('pages.importExport.msMoneyImport.leaseExpired.title')"
    >
      <p>{{ $t('pages.importExport.msMoneyImport.leaseExpired.description') }}</p>
      <Button variant="destructive" size="sm" class="mt-3" @click="store.reset()">
        {{ $t('pages.importExport.msMoneyImport.leaseExpired.action') }}
      </Button>
    </Callout>

    <!-- Numbered stepper. Container-query driven so it reacts to the content width, not the
         viewport (sidebar). Shared with the other wizards via the common container identifier. -->
    <WizardStepper
      class="mb-6"
      :steps="stepperSteps"
      :current-step-key="store.currentStepKey"
      :completed-step-keys="store.completedStepKeys"
      @navigate="(key) => onNavigate({ key })"
    />

    <!-- Active step panel -->
    <Card>
      <CardContent class="pt-2 sm:pt-6">
        <FileUploadStep v-if="store.currentStepKey === 'upload'" />
        <ResolveStep v-else-if="store.currentStepKey === 'resolve'" />
        <ReviewStep v-else-if="store.currentStepKey === 'review'" />
        <ExecuteStep v-else-if="store.currentStepKey === 'execute'" />
        <DoneStep v-else-if="store.currentStepKey === 'done'" />
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import ResourceLeaseBadge from '@/components/common/resource-lease-badge.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card, CardContent } from '@/components/lib/ui/card';
import { useResourceLease } from '@/composable/use-resource-lease';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { ROUTES_NAMES } from '@/routes';
import {
  MS_MONEY_STEPS_WITHOUT_UPLOAD,
  MS_MONEY_STEP_LABEL_KEYS,
  toMsMoneyImportStepKey,
  useImportMsMoneyStore,
} from '@/stores/import-ms-money';
import { ChevronLeftIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import WizardStepper from '@/components/common/wizard-stepper.vue';
import DoneStep from './components/done-step.vue';
import ExecuteStep from './components/execute-step.vue';
import FileUploadStep from './components/file-upload-step.vue';
import ResolveStep from './components/resolve-step.vue';
import ReviewStep from './components/review-step.vue';

const store = useImportMsMoneyStore();

/** Visible steps paired with their localized label keys for the shared stepper. */
const stepperSteps = computed(() =>
  store.visibleSteps.map((step) => ({ key: step.key, labelKey: MS_MONEY_STEP_LABEL_KEYS[step.key] })),
);

const { lease } = storeToRefs(store);

const isLeaseHeld = computed(
  () => store.uploadId !== null && !MS_MONEY_STEPS_WITHOUT_UPLOAD.includes(store.currentStepKey),
);

const {
  state: leaseState,
  msRemaining,
  formattedRemaining,
  isExpired,
  isCapped,
} = useResourceLease({
  lease,
  refresh: () => store.refreshLease(),
  enabled: isLeaseHeld,
});

function onNavigate({ key }: { key: string }) {
  const stepKey = toMsMoneyImportStepKey({ key });
  if (stepKey) store.goToStep(stepKey);
}

onMounted(() => {
  // The store keeps tracking an enqueued job after this page unmounts. Resetting
  // on top of one would drop the progress watchdog and hand the user a fresh
  // upload form, letting the same ledger be imported a second time.
  if (!store.hasActiveJob) store.reset();
  trackAnalyticsEvent({ event: 'import_opened', properties: { import_type: 'ms-money' } });
});
</script>
