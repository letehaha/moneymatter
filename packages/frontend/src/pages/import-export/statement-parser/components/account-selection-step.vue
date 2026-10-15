<template>
  <div class="space-y-6">
    <!-- Info about extracted data, aggregated over every parsed file -->
    <div v-if="store.mergedTransactions.length" class="bg-muted space-y-2 rounded-lg p-4">
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span class="text-muted-foreground">{{ $t('pages.statementParser.accountSelection.transactions') }}</span>
          <span class="ml-1 font-medium">{{ store.mergedTransactions.length }}</span>
        </div>
        <div v-if="store.importSummary.files > 1">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.accountSelection.files') }}</span>
          <span class="ml-1 font-medium">{{ store.importSummary.files }}</span>
        </div>
        <div v-if="store.detectedBankName">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.accountSelection.bank') }}</span>
          <span class="ml-1 font-medium">{{ store.detectedBankName }}</span>
        </div>
        <div v-if="store.detectedCurrency">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.accountSelection.currency') }}</span>
          <span class="ml-1 font-medium">{{ store.detectedCurrency }}</span>
        </div>
      </div>

      <p v-if="store.importSummary.files > 1" class="text-muted-foreground text-xs">
        {{ $t('pages.statementParser.accountSelection.filesList', { files: parsedFileNames }) }}
      </p>
    </div>

    <!-- Currency selector when not detected -->
    <Callout v-if="!store.detectedCurrency" variant="warning">
      <!-- Files disagreeing on currency land here too, since no single currency
           was detected — but say which, so the choice isn't blind. -->
      <p v-if="store.hasCurrencyConflict">
        {{
          $t('pages.statementParser.accountSelection.currencyConflict', {
            currencies: store.detectedCurrencies.join(', '),
          })
        }}
      </p>
      <p v-else>{{ $t('pages.statementParser.accountSelection.currencyNotDetected') }}</p>
      <div class="mt-3 max-w-xs">
        <Select.Select
          :model-value="store.manualCurrency ?? undefined"
          @update:model-value="(v: any) => handleCurrencyChange(v as string)"
        >
          <Select.SelectTrigger>
            <Select.SelectValue :placeholder="$t('pages.statementParser.selectCurrency')" />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <!-- Every currency, not only the linked ones: a statement can be the first thing
                 that brings a currency in. -->
            <Select.SelectGroup v-if="systemCurrenciesVerbose.linked.length">
              <Select.SelectLabel>
                {{ $t('pages.statementParser.accountSelection.yourCurrenciesGroup') }}
              </Select.SelectLabel>
              <Select.SelectItem v-for="item of systemCurrenciesVerbose.linked" :key="item.code" :value="item.code">
                {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
              </Select.SelectItem>
            </Select.SelectGroup>
            <Select.SelectGroup v-if="systemCurrenciesVerbose.unlinked.length">
              <Select.SelectLabel>
                {{ $t('pages.statementParser.accountSelection.allCurrenciesGroup') }}
              </Select.SelectLabel>
              <Select.SelectItem v-for="item of systemCurrenciesVerbose.unlinked" :key="item.code" :value="item.code">
                {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
              </Select.SelectItem>
            </Select.SelectGroup>
          </Select.SelectContent>
        </Select.Select>
      </div>
    </Callout>

    <!-- Account Selection -->
    <div class="space-y-4">
      <div class="xs:grid-cols-[minmax(0,1fr)_max-content] grid grid-cols-1 flex-wrap gap-3">
        <AccountSelectField
          :model-value="store.selectedAccount"
          :accounts="importTargetAccounts"
          :detected-currency="store.effectiveCurrency"
          :is-new-account="store.isNewAccount"
          :placeholder="$t('pages.statementParser.selectExistingAccount')"
          @update:model-value="selectExistingAccount"
        />

        <Button variant="outline" @click="showCreateDialog = true">
          <PlusIcon class="size-4" />
          {{ $t('pages.statementParser.accountSelection.createNew') }}
        </Button>
      </div>

      <!-- Currency mismatch warning -->
      <Callout
        v-if="
          store.selectedAccount &&
          store.effectiveCurrency &&
          store.selectedAccount.currencyCode !== store.effectiveCurrency
        "
        variant="warning"
      >
        {{
          $t('pages.statementParser.accountSelection.currencyMismatch', {
            statementCurrency: store.effectiveCurrency,
            accountCurrency: store.selectedAccount.currencyCode,
          })
        }}
      </Callout>

      <div class="flex gap-3">
        <Button variant="outline" @click="handleBack">
          <ArrowLeftIcon class="size-4" />
          {{ $t('pages.statementParser.accountSelection.back') }}
        </Button>
        <Button v-if="store.selectedAccount" class="flex-1" @click="handleProceed">
          <template v-if="store.isNewAccount">
            {{ $t('pages.statementParser.accountSelection.importTransactions') }}
          </template>
          <template v-else>{{ $t('pages.statementParser.accountSelection.checkForDuplicates') }}</template>
        </Button>
      </div>
    </div>

    <!-- Create Account Dialog -->
    <CreateAccountForImportDialog
      v-model:open="showCreateDialog"
      :default-currency="store.effectiveCurrency ?? undefined"
      :default-name="store.detectedBankName"
      @created="handleAccountCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import * as Select from '@/components/lib/ui/select';
import { useCurrencyName } from '@/composable';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { useStatementParserStore } from '@/stores/statement-parser';
import { ACCOUNT_STATUSES, type AccountModel } from '@bt/shared/types';
import { ArrowLeftIcon, PlusIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import AccountSelectField from './account-select-field.vue';
import CreateAccountForImportDialog from './create-account-for-import-dialog.vue';

const store = useStatementParserStore();
const accountsStore = useAccountsStore();
const currenciesStore = useCurrenciesStore();
const { importLinkableAccounts } = storeToRefs(accountsStore);
const { systemCurrenciesVerbose } = storeToRefs(currenciesStore);
const { formatCurrencyLabel } = useCurrencyName();

const showCreateDialog = ref(false);

const importTargetAccounts = computed(() =>
  importLinkableAccounts.value.filter((account) => account.status === ACCOUNT_STATUSES.active),
);

/** Names of the files that actually produced transactions, in selection order. */
const parsedFileNames = computed(() => store.extractedEntries.map((entry) => entry.file.name).join(', '));

function selectExistingAccount(account: AccountModel | null) {
  if (account) {
    store.selectAccount({ account, isNew: false });
  } else {
    store.clearSelectedAccount();
  }
}

function handleAccountCreated(account: AccountModel) {
  store.selectAccount({ account, isNew: true });
  showCreateDialog.value = false;
}

function handleCurrencyChange(currencyCode: string) {
  store.setManualCurrency({ currencyCode });
  // Clear selected account when currency changes since it might no longer match
  store.clearSelectedAccount();
}

function handleBack() {
  store.goBack();
}

async function handleProceed() {
  await store.proceedFromAccountSelection();
}
</script>
