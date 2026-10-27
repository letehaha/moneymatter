<script setup lang="ts">
import CurrencyChip from '@/components/common/currency-chip.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { formatUIAmount } from '@/js/helpers';
import { useAccountsStore } from '@/stores';
import { type AccountModel, MAX_PAYMENT_LEGS, type TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { InfoIcon, Link2OffIcon, LinkIcon, LockIcon, PlusIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { FormPaymentLeg } from '../types';
import {
  getPaymentLegAccountId,
  isCrossCurrencyLeg,
  isPaymentLegIncomplete,
  refreshLegPaymentAmount,
  setPaymentLegAmount,
  sumMainWithCreatedLegs,
} from '../utils/payment-legs';
import FormRow from './form-row.vue';
import LinkPaymentTransactionsDialog from './link-payment-transactions-dialog.vue';
import PaymentLegRow from './payment-leg-row.vue';

const props = defineProps<{
  label: string;
  /** Options for the main row. */
  mainAccounts: AccountModel[];
  /** Options for the other rows. */
  legAccounts: AccountModel[];
  currencyCode?: string;
  transactionType: TRANSACTION_TYPES;
  time: Date;
  mainTransactionId?: string;
  disabled?: boolean;
  /** Bank-synced main: its account and amount stay as the sync left them. */
  isMainLocked?: boolean;
  hint?: string;
  mainAmountError?: string;
  showLegErrors?: boolean;
}>();

const account = defineModel<AccountModel | null>('account', { required: true });
const amount = defineModel<number | null>('amount', { required: true });
const legs = defineModel<FormPaymentLeg[]>('legs', { required: true });

const emit = defineEmits<{ 'main-amount-blur': [] }>();

const { t } = useI18n();
const { accountsRecord } = storeToRefs(useAccountsStore());
const { convert, ratesMap } = useExchangeRates();

const mainCurrencyCode = computed(() => account.value?.currencyCode);

const legAccountIds = computed(() => new Set(legs.value.map((leg) => getPaymentLegAccountId({ leg }))));
const createdLegAccountIds = computed(
  () => new Set(legs.value.filter((leg) => !leg.isLinked).map((leg) => getPaymentLegAccountId({ leg }))),
);

const mainOptions = computed(() =>
  props.mainAccounts.filter((item) => item.id === account.value?.id || !legAccountIds.value.has(item.id)),
);

const legOptions = ({ leg }: { leg: FormPaymentLeg }) =>
  props.legAccounts.filter(
    (item) =>
      item.id === leg.account?.id || (item.id !== account.value?.id && !createdLegAccountIds.value.has(item.id)),
  );

const refreshAll = ({ resetEdited = false }: { resetEdited?: boolean } = {}) => {
  const next = legs.value.map((leg) =>
    refreshLegPaymentAmount({
      leg: resetEdited ? { ...leg, isPaymentAmountEdited: false } : leg,
      mainCurrencyCode: mainCurrencyCode.value,
      convert,
    }),
  );
  if (next.some((leg, i) => leg !== legs.value[i])) legs.value = next;
};

// Shares typed in the old main currency mean nothing in the new one.
watch(mainCurrencyCode, (_, prev) => refreshAll({ resetEdited: Boolean(prev) }));
watch(ratesMap, () => refreshAll());

const canAddRow = computed(() => legs.value.length < MAX_PAYMENT_LEGS);

const replaceLeg = ({ index, leg }: { index: number; leg: FormPaymentLeg }) => {
  legs.value = legs.value.map((item, i) => (i === index ? leg : item));
};

const updateLeg = ({ index, patch }: { index: number; patch: Partial<FormPaymentLeg> }) =>
  replaceLeg({
    index,
    leg: refreshLegPaymentAmount({
      leg: { ...legs.value[index]!, ...patch },
      mainCurrencyCode: mainCurrencyCode.value,
      convert,
    }),
  });

const setLegAmount = ({ index, value }: { index: number; value: string | number | null }) =>
  replaceLeg({
    index,
    leg: setPaymentLegAmount({
      leg: legs.value[index]!,
      amount: toAmount({ value }),
      mainCurrencyCode: mainCurrencyCode.value,
      convert,
    }),
  });

// A saved part can't move to another account, so a new account means a new row.
const setLegAccount = ({ index, value }: { index: number; value: AccountModel | null }) =>
  updateLeg({
    index,
    patch: {
      account: value,
      accountId: undefined,
      transactionId: undefined,
      currencyCode: value?.currencyCode,
      ...(value?.currencyCode !== legs.value[index]?.currencyCode && {
        paymentAmount: undefined,
        isPaymentAmountEdited: false,
      }),
    },
  });

const addRow = () => {
  legs.value = [...legs.value, { account: null, amount: null }];
};

const linkTransactions = (transactions: TransactionModel[]) => {
  legs.value = [
    ...legs.value,
    ...transactions.map((tx) =>
      refreshLegPaymentAmount({
        leg: {
          transactionId: tx.id,
          account: accountsRecord.value[tx.accountId] ?? null,
          accountId: tx.accountId,
          amount: tx.amount,
          currencyCode: tx.currencyCode,
          isLinked: true,
        },
        mainCurrencyCode: mainCurrencyCode.value,
        convert,
      }),
    ),
  ];
};

const excludedLinkIds = computed(() =>
  [props.mainTransactionId, ...legs.value.map((leg) => leg.transactionId)].filter((id): id is string => !!id),
);

const toAmount = ({ value }: { value: string | number | null }) =>
  value === null || value === '' ? null : Number(value);

const removeLeg = ({ index }: { index: number }) => {
  // A locked main's amount is never sent, so a merged total would show but not save.
  if (legs.value.length === 1 && !props.isMainLocked) {
    amount.value = sumMainWithCreatedLegs({
      mainAmount: amount.value,
      legs: legs.value,
      mainCurrencyCode: mainCurrencyCode.value,
    });
  }
  legs.value = legs.value.filter((_, i) => i !== index);
};

// The first created row takes over as the main; a linked row can't, its account and amount are fixed.
const firstCreatedIndex = computed(() => legs.value.findIndex((leg) => !leg.isLinked));
const removeMain = () => {
  const next = legs.value[firstCreatedIndex.value];
  if (!next) return;
  account.value = next.account;
  amount.value = next.amount;
  legs.value = legs.value.filter((_, i) => i !== firstCreatedIndex.value);
};

const legError = ({ leg }: { leg: FormPaymentLeg }) =>
  props.showLegErrors && isPaymentLegIncomplete({ leg, mainCurrencyCode: mainCurrencyCode.value })
    ? t('dialogs.manageTransaction.form.validation.required')
    : undefined;

const RATE_DIGITS = 4;
const formatRate = ({ rate, from, to }: { rate: number; from: string; to: string }) =>
  t('dialogs.manageTransaction.form.paymentLegs.rateValue', {
    from,
    to,
    rate: rate.toFixed(RATE_DIGITS),
  });

const rateInfo = ({ leg }: { leg: FormPaymentLeg }) => {
  const main = mainCurrencyCode.value!;
  const own = leg.currencyCode!;
  const legAmount = Number(leg.amount);
  const share = Number(leg.paymentAmount);
  const mainRate = ratesMap.value[main]?.rate;
  const ownRate = ratesMap.value[own]?.rate;
  return {
    hasMarketRate: convert({ amount: 1, from: own, to: main }) !== null,
    conversion:
      legAmount > 0 && share > 0
        ? {
            text: `${formatUIAmount(legAmount, { currency: own })} → ${formatUIAmount(share, { currency: main })}`,
            rate: formatRate({ rate: legAmount / share, from: main, to: own }),
          }
        : undefined,
    market: mainRate && ownRate ? formatRate({ rate: mainRate / ownRate, from: main, to: own }) : undefined,
  };
};

const legRateInfos = computed(() =>
  legs.value.map((leg) =>
    isCrossCurrencyLeg({ leg, mainCurrencyCode: mainCurrencyCode.value }) ? rateInfo({ leg }) : undefined,
  ),
);

const legRemoveLabel = ({ leg }: { leg: FormPaymentLeg }) =>
  leg.isLinked
    ? t('dialogs.manageTransaction.form.paymentLegs.unlink')
    : t('dialogs.manageTransaction.form.paymentLegs.removeRow');

const legAccountPlaceholder = ({ leg }: { leg: FormPaymentLeg }) =>
  leg.account || !leg.accountId
    ? t('dialogs.manageTransaction.form.selectAccountPlaceholder')
    : t('common.transactions.record.hiddenAccount');

const mainRowRef = ref<InstanceType<typeof PaymentLegRow> | null>(null);

defineExpose({
  focus: () => mainRowRef.value?.focus(),
  select: () => mainRowRef.value?.select(),
});
</script>

<template>
  <FormRow>
    <FieldLabel :label="label" only-template>
      <template #label-right>
        <slot name="label-right" />
      </template>

      <div class="grid gap-2">
        <PaymentLegRow
          ref="mainRowRef"
          :account="account"
          :accounts="mainOptions"
          :account-placeholder="$t('dialogs.manageTransaction.form.selectAccountPlaceholder')"
          :amount="amount"
          :currency-code="currencyCode"
          :locked="isMainLocked"
          :disabled="disabled"
          :error-message="mainAmountError"
          @update:account="account = $event"
          @update:amount="amount = toAmount({ value: $event })"
          @amount-blur="emit('main-amount-blur')"
        >
          <template #actions>
            <ResponsiveTooltip
              v-if="isMainLocked"
              :content="$t('dialogs.manageTransaction.form.paymentLegs.syncedLock')"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground size-6"
                :aria-label="$t('dialogs.manageTransaction.form.paymentLegs.syncedLock')"
              >
                <LockIcon class="size-3.5" />
              </Button>
            </ResponsiveTooltip>
            <DesktopOnlyTooltip v-else :content="$t('dialogs.manageTransaction.form.paymentLegs.removeRow')">
              <Button
                type="button"
                variant="soft-destructive"
                size="icon-sm"
                class="size-6"
                :disabled="disabled || firstCreatedIndex === -1"
                :aria-label="$t('dialogs.manageTransaction.form.paymentLegs.removeRow')"
                @click="removeMain"
              >
                <XIcon class="size-3.5" />
              </Button>
            </DesktopOnlyTooltip>
          </template>
        </PaymentLegRow>

        <div v-for="(leg, index) in legs" :key="leg.transactionId ?? index">
          <PaymentLegRow
            :account="leg.account"
            :accounts="leg.isLinked ? (leg.account ? [leg.account] : []) : legOptions({ leg })"
            :account-placeholder="legAccountPlaceholder({ leg })"
            :amount="leg.amount"
            :currency-code="leg.currencyCode ?? currencyCode"
            :locked="leg.isLinked"
            :disabled="disabled"
            :error-message="legError({ leg })"
            @update:account="setLegAccount({ index, value: $event })"
            @update:amount="setLegAmount({ index, value: $event })"
          >
            <template v-if="leg.isLinked" #account-addon>
              <ResponsiveTooltip content-class-name="max-w-72">
                <template #content>
                  <p class="mb-1 font-medium">
                    {{ $t('dialogs.manageTransaction.form.paymentLegs.linkedChangesTitle') }}
                  </p>
                  <p>
                    {{ $t('dialogs.manageTransaction.form.paymentLegs.linkedChangesTakes') }}
                  </p>
                  <p>
                    {{ $t('dialogs.manageTransaction.form.paymentLegs.linkedChangesKeeps') }}
                  </p>
                  <p>
                    {{ $t('dialogs.manageTransaction.form.paymentLegs.linkedChangesUnlink') }}
                  </p>
                </template>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="text-primary-text hover:text-primary-text mr-1 size-6 shrink-0"
                  :aria-label="$t('dialogs.manageTransaction.form.paymentLegs.linkedChangesTitle')"
                >
                  <LinkIcon class="size-3.5" />
                </Button>
              </ResponsiveTooltip>
            </template>

            <template v-if="legRateInfos[index]" #converted>
              <span class="text-muted-foreground" aria-hidden="true">≈</span>
              <InputField
                class="min-w-0 flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                :model-value="leg.paymentAmount ?? null"
                type="number"
                only-positive
                :aria-label="
                  $t('dialogs.manageTransaction.form.paymentLegs.convertedAmountLabel', { currency: currencyCode })
                "
                :disabled="disabled"
                @update:model-value="
                  updateLeg({
                    index,
                    patch: {
                      paymentAmount: toAmount({ value: $event }),
                      isPaymentAmountEdited: true,
                    },
                  })
                "
              />
              <CurrencyChip v-if="currencyCode" class="hidden @sm:inline" :code="currencyCode" />
              <ResponsiveTooltip content-class-name="max-w-72">
                <template #content>
                  <div class="grid gap-2">
                    <div v-if="legRateInfos[index]!.conversion">
                      <p class="font-medium">
                        {{ $t('dialogs.manageTransaction.form.paymentLegs.rateFromAmounts') }}
                      </p>
                      <p class="tabular-nums">
                        {{ legRateInfos[index]!.conversion!.text }}
                      </p>
                      <p class="tabular-nums">
                        {{ legRateInfos[index]!.conversion!.rate }}
                      </p>
                    </div>
                    <div v-if="legRateInfos[index]!.market">
                      <p class="font-medium">
                        {{ $t('dialogs.manageTransaction.form.paymentLegs.marketRate') }}
                      </p>
                      <p class="tabular-nums">
                        {{ legRateInfos[index]!.market }}
                      </p>
                    </div>
                    <p v-if="!leg.isPaymentAmountEdited" class="text-muted-foreground">
                      {{ $t('dialogs.manageTransaction.form.paymentLegs.convertedHint', { currency: currencyCode }) }}
                    </p>
                  </div>
                </template>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground size-6 shrink-0"
                  :aria-label="$t('dialogs.manageTransaction.form.paymentLegs.rateInfo')"
                >
                  <InfoIcon class="size-3.5" />
                </Button>
              </ResponsiveTooltip>
            </template>

            <template #actions>
              <DesktopOnlyTooltip :content="legRemoveLabel({ leg })">
                <Button
                  type="button"
                  variant="soft-destructive"
                  size="icon-sm"
                  class="size-6"
                  :disabled="disabled"
                  :aria-label="legRemoveLabel({ leg })"
                  @click="removeLeg({ index })"
                >
                  <Link2OffIcon v-if="leg.isLinked" class="size-3.5" />
                  <XIcon v-else class="size-3.5" />
                </Button>
              </DesktopOnlyTooltip>
            </template>
          </PaymentLegRow>

          <p
            v-if="legRateInfos[index] && !legRateInfos[index]!.hasMarketRate && !leg.isPaymentAmountEdited"
            class="text-muted-foreground mt-1 px-1 text-right text-xs"
          >
            {{
              $t('dialogs.manageTransaction.form.paymentLegs.noMarketRate', {
                currency: leg.currencyCode,
              })
            }}
          </p>
        </div>

        <div v-if="canAddRow" class="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="ghost"
            class="text-muted-foreground hover:text-foreground w-full border border-dashed"
            :disabled="disabled"
            @click="addRow"
          >
            <PlusIcon class="size-4" />
            {{ $t('dialogs.manageTransaction.form.paymentLegs.addAccount') }}
          </Button>
          <LinkPaymentTransactionsDialog
            :transaction-type="transactionType"
            :time="time"
            :exclude-ids="excludedLinkIds"
            :max-count="MAX_PAYMENT_LEGS - legs.length"
            @link="linkTransactions"
          >
            <Button
              type="button"
              variant="ghost"
              class="text-muted-foreground hover:text-foreground w-full border border-dashed"
              :disabled="disabled"
            >
              <LinkIcon class="size-4" />
              {{ $t('dialogs.manageTransaction.form.paymentLegs.linkExisting') }}
            </Button>
          </LinkPaymentTransactionsDialog>
        </div>

        <p v-if="hint" class="text-muted-foreground px-1 text-xs">{{ hint }}</p>
      </div>
    </FieldLabel>
  </FormRow>
</template>
