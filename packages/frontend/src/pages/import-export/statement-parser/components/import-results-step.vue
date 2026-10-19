<template>
  <div class="@container/import-step space-y-6">
    <div v-if="store.isImporting" class="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2Icon class="text-primary-text size-10 animate-spin" />
      <div>
        <h3 class="text-lg font-semibold">{{ $t('pages.statementParser.importResults.importingTitle') }}</h3>
        <p class="text-muted-foreground mt-1 text-sm">
          {{ $t('pages.statementParser.importResults.importingDescription') }}
        </p>
      </div>
    </div>

    <template v-else-if="store.importResult">
      <div class="flex flex-col items-center gap-3 text-center">
        <div
          :class="
            cn('flex size-14 items-center justify-center rounded-full', hasErrors ? 'bg-warning/15' : 'bg-success/20')
          "
        >
          <CircleCheckIcon v-if="!hasErrors" class="text-success-text size-7" />
          <TriangleAlertIcon v-else class="text-warning-text size-7" />
        </div>
        <div>
          <h2 class="text-lg font-semibold">
            {{
              hasErrors
                ? $t('pages.statementParser.importResults.completeWithIssuesTitle')
                : $t('pages.statementParser.importResults.completeTitle')
            }}
          </h2>
          <p class="text-muted-foreground mt-1 text-sm">
            {{
              hasErrors
                ? $t('pages.statementParser.importResults.partialDescription')
                : $t('pages.statementParser.importResults.successDescription')
            }}
          </p>
        </div>
      </div>

      <dl class="grid grid-cols-2 gap-3">
        <div class="bg-muted/40 border-border/60 rounded-lg border p-3">
          <dt class="text-muted-foreground text-xs">
            {{ $t('pages.statementParser.importResults.importedLabel') }}
          </dt>
          <dd class="text-app-income-color mt-0.5 text-xl font-semibold tabular-nums">
            {{ store.importResult.imported }}
          </dd>
        </div>
        <div class="bg-muted/40 border-border/60 rounded-lg border p-3">
          <dt class="text-muted-foreground text-xs">
            {{ $t('pages.statementParser.importResults.skippedLabel') }}
          </dt>
          <dd class="mt-0.5 text-xl font-semibold tabular-nums">{{ store.importResult.skipped }}</dd>
        </div>
      </dl>

      <div v-if="hasErrors" class="space-y-2">
        <h3 class="text-destructive-text text-sm font-semibold">
          {{ $t('pages.statementParser.importResults.errorsTitle') }}
        </h3>
        <ScrollArea class="border-border/60 max-h-48 rounded-lg border" viewport-class="max-h-48">
          <table class="w-full text-sm">
            <thead class="bg-muted/60">
              <tr>
                <th class="border-border/60 border-b px-3 py-2 text-left font-medium">
                  {{ $t('pages.statementParser.importResults.transactionNumberHeader') }}
                </th>
                <th class="border-border/60 border-b px-3 py-2 text-left font-medium">
                  {{ $t('pages.statementParser.importResults.errorHeader') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="error in store.importResult.errors"
                :key="error.transactionIndex"
                class="border-border/60 border-b last:border-b-0"
              >
                <td class="px-3 py-2 font-mono tabular-nums">{{ error.transactionIndex + 1 }}</td>
                <td class="text-destructive-text px-3 py-2">{{ formatStatementImportRowError({ error, t }) }}</td>
              </tr>
            </tbody>
          </table>
        </ScrollArea>
      </div>

      <i18n-t keypath="pages.statementParser.importResults.batchIdNote" tag="p" class="text-muted-foreground text-xs">
        <template #batchId>
          <span class="font-mono">{{ store.importResult.batchId }}</span>
        </template>
      </i18n-t>

      <div class="flex flex-col gap-2 @sm/import-step:flex-row">
        <Button variant="outline" class="flex-1" @click="store.reset()">
          {{ $t('pages.statementParser.importResults.startNewImportButton') }}
        </Button>
        <Button class="flex-1" @click="handleViewTransactions">
          {{ $t('pages.statementParser.importResults.viewTransactionsButton') }}
        </Button>
      </div>
    </template>

    <!-- The job started and then failed: rows may already have landed, so this screen
         offers no retry. -->
    <template v-else-if="store.importJobError">
      <Callout variant="destructive" :title="$t('pages.statementParser.importResults.failedTitle')">
        <p>{{ $t('pages.statementParser.importResults.jobFailedDescription') }}</p>
        <ScrollArea class="border-destructive/50 mt-2 max-h-32 rounded-md border" viewport-class="max-h-32">
          <p class="px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">{{ store.importJobError }}</p>
        </ScrollArea>
      </Callout>

      <div class="flex flex-col gap-2 @sm/import-step:flex-row">
        <Button variant="outline" class="flex-1" @click="store.reset()">
          {{ $t('pages.statementParser.importResults.startNewImportButton') }}
        </Button>
        <Button class="flex-1" @click="handleViewTransactions">
          {{ $t('pages.statementParser.importResults.viewTransactionsButton') }}
        </Button>
      </div>
    </template>

    <!-- Ready, and the same screen after the job failed to start: the summary stays and
         only the actions change. -->
    <template v-else>
      <div>
        <h3 class="text-lg font-semibold">{{ $t('pages.statementParser.importResults.readyTitle') }}</h3>
        <p class="text-muted-foreground text-sm">
          {{ $t('pages.statementParser.importResults.readyDescription') }}
        </p>
      </div>

      <div class="border-border/60 bg-muted/30 divide-border/60 divide-y rounded-lg border">
        <div class="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <span class="text-muted-foreground text-sm">
            {{ $t('pages.statementParser.importResults.accountLabel') }}
          </span>
          <span class="text-right text-sm font-medium">
            {{ store.selectedAccount?.name }}
            <span class="text-muted-foreground">({{ store.selectedAccount?.currencyCode }})</span>
          </span>
        </div>
        <div v-if="store.importSummary.files > 1" class="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <span class="text-muted-foreground text-sm">
            {{ $t('pages.statementParser.importResults.statementsLabel') }}
          </span>
          <span class="text-right text-sm font-medium tabular-nums">{{ store.importSummary.files }}</span>
        </div>
        <div class="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <span class="text-muted-foreground text-sm">
            {{ $t('pages.statementParser.importResults.toImportLabel') }}
          </span>
          <span class="text-app-income-color text-base font-semibold tabular-nums">
            {{ store.importSummary.toImport }}
          </span>
        </div>
        <div class="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <span class="text-muted-foreground text-sm">
            {{ $t('pages.statementParser.importResults.toSkipLabel') }}
          </span>
          <span class="text-base font-semibold tabular-nums">{{ skippedCount }}</span>
        </div>
      </div>

      <!-- Without this the count above silently under-reports the uploaded file. -->
      <Callout v-if="store.droppedRowCount > 0" variant="warning">
        {{ $t('pages.statementParser.droppedRowsWarning', { count: store.droppedRowCount }) }}
      </Callout>

      <Callout
        v-if="store.importError"
        variant="destructive"
        :title="$t('pages.statementParser.importResults.failedTitle')"
      >
        <p>{{ $t('pages.statementParser.importResults.failedDescription') }}</p>
        <ScrollArea class="border-destructive/50 mt-2 max-h-32 rounded-md border" viewport-class="max-h-32">
          <p class="px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">{{ store.importError }}</p>
        </ScrollArea>
      </Callout>

      <div class="flex flex-col gap-2 @sm/import-step:flex-row">
        <Button variant="outline" class="@sm/import-step:flex-none" @click="handleBack">
          <ArrowLeftIcon class="size-4" />
          {{ $t('pages.statementParser.importResults.backButton') }}
        </Button>
        <Button class="flex-1" :disabled="store.importSummary.toImport === 0" @click="handleImport">
          {{
            store.importError
              ? $t('pages.statementParser.importResults.tryAgainButton')
              : $t('pages.statementParser.importResults.importButton', { count: store.importSummary.toImport })
          }}
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useStatementParserStore } from '@/stores/statement-parser';
import { ArrowLeftIcon, CircleCheckIcon, Loader2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { formatStatementImportRowError } from '../utils/import-row-error-message';

const { t } = useI18n();
const store = useStatementParserStore();
const router = useRouter();

const hasErrors = computed(() => (store.importResult?.errors.length ?? 0) > 0);

const skippedCount = computed(() => store.importSummary.total - store.importSummary.toImport);

function handleBack() {
  // Walks to the previous visible step: `review` for existing accounts (where it
  // is shown) or `account` for new accounts (where `review` is hidden).
  store.goBack();
}

async function handleImport() {
  await store.executeImport();
}

function handleViewTransactions() {
  router.push({ name: ROUTES_NAMES.transactions });
}
</script>
