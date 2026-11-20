<template>
  <template v-if="accounts.length || account">
    <template v-if="isTransferTransaction && !isTransactionLinking">
      <form-row>
        <AccountSelectField
          data-test="account-select-field"
          :label="$t('dialogs.manageTransaction.form.fromAccountLabel')"
          :placeholder="$t('dialogs.manageTransaction.form.selectAccountPlaceholder')"
          :accounts="accounts"
          include-out-of-wallet
          :disabled="disabled || fromAccountDisabled"
          :model-value="account"
          @update:model-value="updateFormAccount"
        >
          <template v-if="account?.id === OUT_OF_WALLET_ACCOUNT_MOCK.id" #label-right>
            <DocsLink :path="OUT_OF_WALLET_DOCS_PATH" class="text-xs">
              {{ $t('dialogs.manageTransaction.form.outOfWalletDocsLink') }}
            </DocsLink>
          </template>
          <template #select-bottom-content>
            <CreateAccountDialog>
              <UiButton type="button" class="w-full justify-start" variant="ghost-primary" size="sm">
                <PlusIcon class="size-4" />
                {{ $t('dialogs.manageTransaction.form.addNewAccountButton') }}
              </UiButton>
            </CreateAccountDialog>
          </template>
        </AccountSelectField>
      </form-row>

      <form-row>
        <DestinationPanel :label="$t('dialogs.manageTransaction.form.destinationGroupLabel')">
          <form-row>
            <PillTabs
              :model-value="destinationType"
              :items="destinationTypeItems"
              size="sm"
              :disabled="disabled || toAccountDisabled || destinationTypeDisabled"
              class="w-full"
              @update:model-value="updateDestinationType"
            />
          </form-row>

          <form-row v-if="destinationType === 'account'">
            <AccountSelectField
              :label="$t('dialogs.manageTransaction.form.toAccountLabel')"
              :placeholder="$t('dialogs.manageTransaction.form.selectAccountPlaceholder')"
              :accounts="filteredAccounts"
              :include-out-of-wallet="account?.id !== OUT_OF_WALLET_ACCOUNT_MOCK.id"
              :disabled="disabled || toAccountDisabled"
              :model-value="toAccount"
              @update:model-value="updateToAccount"
            >
              <template v-if="toAccount?.id === OUT_OF_WALLET_ACCOUNT_MOCK.id" #label-right>
                <DocsLink :path="OUT_OF_WALLET_DOCS_PATH" class="text-xs">
                  {{ $t('dialogs.manageTransaction.form.outOfWalletDocsLink') }}
                </DocsLink>
              </template>
              <template #select-bottom-content>
                <CreateAccountDialog>
                  <UiButton type="button" class="w-full justify-start" variant="ghost-primary" size="sm">
                    <PlusIcon class="size-4" />
                    {{ $t('dialogs.manageTransaction.form.addNewAccountButton') }}
                  </UiButton>
                </CreateAccountDialog>
              </template>
            </AccountSelectField>
          </form-row>

          <form-row v-else-if="destinationType === 'portfolio'">
            <select-field
              :label="$t('dialogs.manageTransaction.form.toPortfolioLabel')"
              :placeholder="
                portfolios.length
                  ? $t('dialogs.manageTransaction.form.selectPortfolioPlaceholder')
                  : $t('dialogs.manageTransaction.form.noPortfoliosExist')
              "
              :values="portfolios"
              label-key="name"
              value-key="id"
              with-search
              :disabled="disabled || toAccountDisabled || !portfolios.length"
              :model-value="toPortfolio"
              @update:model-value="updateToPortfolio"
            />
          </form-row>

          <form-row v-else>
            <AccountSelectField
              :label="$t('dialogs.manageTransaction.form.toLoanLabel')"
              :placeholder="
                loanAccounts.length
                  ? $t('dialogs.manageTransaction.form.selectLoanPlaceholder')
                  : $t('dialogs.manageTransaction.form.noLoansExist')
              "
              :accounts="loanAccounts"
              :disabled="disabled || toAccountDisabled || !loanAccounts.length"
              :model-value="toAccount"
              @update:model-value="updateToAccount"
            />
          </form-row>

          <slot name="destination-bottom" />
        </DestinationPanel>
      </form-row>
    </template>
    <template v-else>
      <form-row>
        <AccountSelectField
          data-test="account-select-field"
          :label="$t('dialogs.manageTransaction.form.accountLabel')"
          :placeholder="$t('dialogs.manageTransaction.form.selectAccountPlaceholder')"
          :accounts="accounts"
          :disabled="disabled || fromAccountDisabled"
          :model-value="account"
          @update:model-value="updateFormAccount"
        >
          <template
            v-if="$slots['account-label-pill'] || ($slots['account-label-right'] && !$slots['account-field-right'])"
            #label-right
          >
            <div class="flex items-center gap-2">
              <slot name="account-label-pill" />
              <slot v-if="!$slots['account-field-right']" name="account-label-right" />
            </div>
          </template>
          <template v-if="$slots['account-field-right']" #field-right>
            <slot name="account-field-right" />
          </template>
          <template #select-bottom-content>
            <CreateAccountDialog>
              <UiButton type="button" class="w-full justify-start" variant="ghost-primary" size="sm">
                <PlusIcon class="size-4" />
                {{ $t('dialogs.manageTransaction.form.addNewAccountButton') }}
              </UiButton>
            </CreateAccountDialog>
          </template>
        </AccountSelectField>

        <slot name="account-hint" />
      </form-row>
    </template>
  </template>
  <template v-else>
    <form-row>
      <input-field
        :model-value="$t('dialogs.manageTransaction.form.noAccountExists')"
        :label="$t('dialogs.manageTransaction.form.accountLabel')"
        readonly
        non-label-wrapper
        :disabled="disabled"
      >
        <template #label-right>
          <div class="flex items-center gap-3">
            <slot name="account-label-right" />
            <CreateAccountDialog>
              <div class="text-primary-text cursor-pointer hover:underline">
                {{ $t('dialogs.manageTransaction.form.createAccountLink') }}
              </div>
            </CreateAccountDialog>
          </div>
        </template>
      </input-field>
    </form-row>
  </template>
</template>

<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import CreateAccountDialog from '@/components/dialogs/create-account-dialog.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { OUT_OF_WALLET_ACCOUNT_MOCK } from '@/common/const';
import { AccountModel, PortfolioModel, TRANSACTION_TYPES } from '@bt/shared/types';
import { BriefcaseIcon, HandCoinsIcon, PlusIcon, WalletIcon } from '@lucide/vue';
import { type Component, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { getAvailableTransferDestinationTypes } from '../helpers';
import type { TransferDestinationType } from '../composables/transfer-form';
import DestinationPanel from './destination-panel.vue';
import FormRow from './form-row.vue';

const { t } = useI18n();

const OUT_OF_WALLET_DOCS_PATH = '/transfers-and-refunds/how-transfers-work/#out-of-wallet-transfers';

const DESTINATION_TYPE_META: Record<TransferDestinationType, { labelKey: string; icon: Component }> = {
  account: { labelKey: 'dialogs.manageTransaction.form.destinationTypeAccount', icon: WalletIcon },
  portfolio: { labelKey: 'dialogs.manageTransaction.form.destinationTypePortfolio', icon: BriefcaseIcon },
  loan: { labelKey: 'dialogs.manageTransaction.form.destinationTypeLoan', icon: HandCoinsIcon },
};

const props = withDefaults(
  defineProps<{
    account?: AccountModel | null;
    toAccount?: AccountModel | null;
    toPortfolio?: PortfolioModel | null;
    destinationType?: TransferDestinationType;
    portfolios?: PortfolioModel[];
    loanAccounts?: AccountModel[];
    isTransferTransaction: boolean;
    accounts: AccountModel[];
    filteredAccounts: AccountModel[];
    isTransactionLinking?: boolean;
    transactionType: TRANSACTION_TYPES;
    fromAccountDisabled?: boolean;
    toAccountDisabled?: boolean;
    /** Locks the destination-type pills while keeping the pickers themselves usable. */
    destinationTypeDisabled?: boolean;
    disabled?: boolean;
  }>(),
  {
    account: null,
    toAccount: null,
    toPortfolio: null,
    destinationType: 'account',
    portfolios: () => [],
    loanAccounts: () => [],
    isTransactionLinking: false,
    fromAccountDisabled: false,
    toAccountDisabled: false,
    destinationTypeDisabled: false,
  },
);

const destinationTypeItems = computed(() =>
  getAvailableTransferDestinationTypes(props.transactionType).map((value) => ({
    value,
    label: t(DESTINATION_TYPE_META[value].labelKey),
    icon: DESTINATION_TYPE_META[value].icon,
  })),
);

const emit = defineEmits<{
  'update:account': [account: AccountModel | null];
  'update:to-account': [account: AccountModel | null];
  'update:to-portfolio': [portfolio: PortfolioModel | null];
  'update:destination-type': [type: TransferDestinationType];
}>();

const updateFormAccount = (account: AccountModel | null) => {
  emit('update:account', account);
};

const updateToAccount = (account: AccountModel | null) => {
  emit('update:to-account', account);
};

const updateToPortfolio = (portfolio: PortfolioModel | null) => {
  emit('update:to-portfolio', portfolio);
};

const updateDestinationType = (type: string) => {
  emit('update:destination-type', type as TransferDestinationType);
};
</script>
