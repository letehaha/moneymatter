<script setup lang="ts">
import BackLink from '@/components/common/back-link.vue';
import PageWrapper from '@/components/common/page-wrapper.vue';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import { usePortfolio } from '@/composable/data-queries/portfolios';
import { isResourceMissingError } from '@/js/errors';
import { ROUTES_NAMES } from '@/routes';
import type {
  InvestmentColumnMapping,
  InvestmentImportHolding,
  InvestmentImportWarning,
} from '@bt/shared/types/investments';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ColumnMappingStep from './column-mapping-step.vue';
import type { InvestmentImportParseCsvResult } from './parse-csv-local';
import ReviewStep from './review-step.vue';
import UploadStep from './upload-step.vue';

const route = useRoute();
const router = useRouter();

const portfolioId = computed(() => String(route.params.portfolioId));

const { data: portfolio, isLoading, isError, error } = usePortfolio(portfolioId, { retry: false });

const isNotFound = computed(() => isError.value && isResourceMissingError(error.value));

type Step = 'upload' | 'columnMapping' | 'review';
const step = ref<Step>('upload');

const extractedHoldings = ref<InvestmentImportHolding[]>([]);
const extractedWarnings = ref<InvestmentImportWarning[]>([]);

// CSV-path context. Set when the upload step parses a CSV; consumed by the
// column-mapping step. Stays null on the AI path.
const csvContext = ref<{
  fileBase64: string;
  fileName: string;
  parseResult: InvestmentImportParseCsvResult;
} | null>(null);

// Last mapping the user built in the CSV column-mapping step. Held here so
// returning to that step from review preserves every dropdown pick.
const lastColumnMapping = ref<InvestmentColumnMapping | null>(null);

function onExtracted(payload: {
  holdings: InvestmentImportHolding[];
  warnings: InvestmentImportWarning[];
  mapping?: InvestmentColumnMapping;
}) {
  extractedHoldings.value = payload.holdings;
  extractedWarnings.value = payload.warnings;
  if (payload.mapping) lastColumnMapping.value = payload.mapping;
  step.value = 'review';
}

function onCsvParsed(payload: { fileBase64: string; fileName: string; parseResult: InvestmentImportParseCsvResult }) {
  csvContext.value = payload;
  // New CSV file — drop any persisted mapping; its column names may not exist
  // in the new file's headers and we'd rather auto-pick than show stale picks.
  lastColumnMapping.value = null;
  step.value = 'columnMapping';
}

function goBackToUpload() {
  step.value = 'upload';
  csvContext.value = null;
  lastColumnMapping.value = null;
}

// Back-from-review behaves differently per path:
//   - CSV: return to the column-mapping step with the previously-built mapping
//     restored, so the user can tweak picks without redoing the upload.
//   - AI:  no intermediate step; fall back to the upload entry point.
function onBackFromReview() {
  if (csvContext.value) {
    step.value = 'columnMapping';
  } else {
    goBackToUpload();
  }
}

function onImported() {
  router.push({ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId: portfolioId.value } });
}
</script>

<template>
  <PageWrapper class="pt-4">
    <BackLink :to="{ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId } }">
      {{ $t('investmentsImport.backToPortfolio') }}
    </BackLink>

    <div class="mb-6">
      <h1 class="text-2xl tracking-wider">{{ $t('investmentsImport.title') }}</h1>
      <p class="text-muted-foreground mt-2 text-sm sm:text-base">
        {{ $t('investmentsImport.description') }}
      </p>
    </div>

    <div class="@container/import max-w-5xl">
      <!-- Loading skeleton — approximates the upload card shape -->
      <div v-if="isLoading" class="rounded-xl border p-5">
        <div class="bg-muted mb-5 h-11 w-full animate-pulse rounded-full" />
        <div class="bg-muted mb-5 h-40 w-full animate-pulse rounded-xl" />
        <div class="flex justify-end gap-2">
          <div class="bg-muted h-9 w-28 animate-pulse rounded-md" />
          <div class="bg-muted h-9 w-28 animate-pulse rounded-md" />
        </div>
      </div>

      <!-- Portfolio missing or no access -->
      <ResourceNotFound
        v-else-if="isNotFound"
        :title="$t('portfolioDetail.notFoundTitle')"
        :description="$t('portfolioDetail.notFoundDescription')"
        :link-label="$t('portfolioDetail.backToInvestments')"
        :link-to="{ name: ROUTES_NAMES.investments }"
      />

      <!-- Other error (network, server) -->
      <div v-else-if="isError" class="text-destructive-text rounded-lg border border-dashed p-6 text-center text-sm">
        {{ $t('portfolioDetail.loadError') }}
      </div>

      <!-- Happy path -->
      <template v-else-if="portfolio">
        <UploadStep
          v-if="step === 'upload'"
          :portfolio-id="portfolioId"
          @extracted="onExtracted"
          @csv-parsed="onCsvParsed"
        />
        <ColumnMappingStep
          v-else-if="step === 'columnMapping' && csvContext"
          :portfolio-id="portfolioId"
          :file-base64="csvContext.fileBase64"
          :file-name="csvContext.fileName"
          :parse-result="csvContext.parseResult"
          :initial-mapping="lastColumnMapping"
          @extracted="onExtracted"
          @back="goBackToUpload"
        />
        <ReviewStep
          v-else
          :portfolio-id="portfolioId"
          :initial-holdings="extractedHoldings"
          :initial-warnings="extractedWarnings"
          @back="onBackFromReview"
          @imported="onImported"
        />
      </template>
    </div>
  </PageWrapper>
</template>
