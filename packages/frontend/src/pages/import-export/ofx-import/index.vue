<template>
  <div class="@container/csv-wizard flex flex-col gap-0">
    <div class="mb-6">
      <RouterLink
        :to="{ name: ROUTES_NAMES.settingsDataManagementImport }"
        class="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeftIcon class="size-4" />{{ $t('settings.dataManagement.import.back') }}
      </RouterLink>
      <div class="mb-2 flex flex-wrap items-center gap-3">
        <h2 class="text-2xl font-semibold">{{ $t('pages.importExport.ofxImport.pageTitle') }}</h2>
        <ResourceLeaseBadge
          v-if="isLeaseHeld"
          :state="leaseState"
          :formatted-remaining="formattedRemaining"
          :ms-remaining="msRemaining"
          :is-capped="isCapped"
          :resource-label="$t('pages.importExport.ofxImport.leaseResourceLabel')"
        />
      </div>
      <p class="text-muted-foreground text-sm">{{ $t('pages.importExport.ofxImport.pageDescription') }}</p>
    </div>
    <Callout
      v-if="isLeaseHeld && isExpired"
      variant="destructive"
      role="alert"
      class="mb-6"
      :title="$t('pages.importExport.ofxImport.leaseExpired.title')"
    >
      <p>{{ $t('pages.importExport.ofxImport.leaseExpired.description') }}</p>
      <Button variant="destructive" size="sm" class="mt-3" @click="store.reset()">{{
        $t('pages.importExport.ofxImport.leaseExpired.action')
      }}</Button>
    </Callout>
    <WizardStepper
      class="mb-6"
      :steps="stepperSteps"
      :current-step-key="store.currentStepKey"
      :completed-step-keys="store.completedStepKeys"
      @navigate="(key) => onNavigate({ key })"
    />
    <Card
      ><CardContent class="pt-2 sm:pt-6">
        <FileUploadStep v-if="store.currentStepKey === 'upload'" />
        <ResolveStep v-else-if="store.currentStepKey === 'resolve'" />
        <ReviewStep v-else-if="store.currentStepKey === 'review'" />
        <template v-else
          ><DoneStep v-if="store.progress?.status === 'completed'" /><ExecuteStep v-else
        /></template> </CardContent
    ></Card>
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
import { OFX_STEP_LABEL_KEYS, toOfxImportStepKey, useImportOfxStore } from '@/stores/import-ofx';
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

const store = useImportOfxStore();
const { lease } = storeToRefs(store);
const stepperSteps = computed(() =>
  store.visibleSteps.map((step) => ({ key: step.key, labelKey: OFX_STEP_LABEL_KEYS[step.key] })),
);
const isLeaseHeld = computed(() => store.uploadId !== null && store.currentStepKey !== 'results');
const {
  state: leaseState,
  msRemaining,
  formattedRemaining,
  isExpired,
  isCapped,
} = useResourceLease({ lease, refresh: () => store.refreshLease(), enabled: isLeaseHeld });
function onNavigate({ key }: { key: string }) {
  const step = toOfxImportStepKey({ key });
  if (step) store.goToStep(step);
}
onMounted(() => {
  if (!store.hasActiveJob) store.reset();
  trackAnalyticsEvent({ event: 'import_opened', properties: { import_type: 'ofx' } });
});
</script>
