<script setup lang="ts">
import {
  ACCOUNT_CATEGORIES_TRANSLATION_KEYS,
  NO_PAYMENT_TYPE_OPTION,
  NULLABLE_PAYMENT_TYPE_OPTIONS,
} from '@/common/const';
import { formatExternalUrlLabel, safeExternalUrl } from '@/common/utils/external-url';
import * as Collapsible from '@/components/lib/ui/collapsible';
import { Separator } from '@/components/lib/ui/separator';
import * as Tabs from '@/components/lib/ui/tabs';
import { useAccountAccess } from '@/composable/use-account-access';
import { useAccountCurrencyCode } from '@/composable/use-account-currency-code';
import { toLocalCurrencyNumber } from '@/js/helpers';
import { useCurrenciesStore } from '@/stores';
import { ACCOUNT_TYPES, AccountModel, isDedicatedFlowAccountCategory } from '@bt/shared/types';
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, defineAsyncComponent, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

const CreditLimitEditPopover = defineAsyncComponent(() => import('./credit-limit-edit-popover.vue'));
const InitialBalanceEditPopover = defineAsyncComponent(() => import('./initial-balance-edit-popover.vue'));
const AccountCategoryEditPopover = defineAsyncComponent(() => import('./account-category-edit-popover.vue'));
const AccountDefaultPaymentTypeEditPopover = defineAsyncComponent(
  () => import('./account-default-payment-type-edit-popover.vue'),
);
const AccountExternalUrlEditPopover = defineAsyncComponent(() => import('./account-external-url-edit-popover.vue'));

const { t } = useI18n();

const props = defineProps<{
  account: AccountModel;
  tabName: string;
}>();

const { currenciesMap } = storeToRefs(useCurrenciesStore());
const isOpen = ref(false);

const currencyCode = useAccountCurrencyCode({ account: toRef(() => props.account) });
const { isOwner } = useAccountAccess(toRef(() => props.account));
// Loan and vehicle categories are locked to their dedicated flows on the backend.
const isCategoryEditable = computed(
  () => isOwner.value && !isDedicatedFlowAccountCategory(props.account.accountCategory),
);
const defaultPaymentTypeLabelKey = computed(
  () =>
    (
      NULLABLE_PAYMENT_TYPE_OPTIONS.find((option) => option.value === (props.account.defaultPaymentType ?? null)) ??
      NO_PAYMENT_TYPE_OPTION
    ).label,
);
const isInitialBalanceEditable = computed(
  () => isCategoryEditable.value && props.account.type === ACCOUNT_TYPES.system,
);
const externalUrlHref = computed(() => safeExternalUrl({ value: props.account.externalUrl }));
const externalUrlLabel = computed(() =>
  externalUrlHref.value ? formatExternalUrlLabel({ value: externalUrlHref.value }) : null,
);
</script>

<template>
  <Tabs.TabsContent :value="tabName">
    <div class="grid gap-4 py-6 text-sm">
      <div class="flex items-center justify-between gap-2">
        <span>{{ t('pages.account.details.creditLimit') }}</span>

        <div class="flex items-center gap-1.5">
          <span
            >{{
              toLocalCurrencyNumber(account.creditLimit, {
                currency: currencyCode,
                meta: account.currencyMeta,
                fullPrecision: true,
              })
            }}
            {{ currencyCode }}</span
          >

          <CreditLimitEditPopover v-if="isOwner" :account="account" :currency-code="currencyCode" />
        </div>
      </div>
      <Separator />

      <div class="flex items-center justify-between gap-2">
        <span>{{ t('pages.account.details.initialBalance') }}</span>

        <div class="flex items-center gap-1.5">
          <span
            >{{
              toLocalCurrencyNumber(account.initialBalance, {
                currency: currencyCode,
                meta: account.currencyMeta,
                fullPrecision: true,
              })
            }}
            {{ currencyCode }}</span
          >

          <InitialBalanceEditPopover v-if="isInitialBalanceEditable" :account="account" :currency-code="currencyCode" />
        </div>
      </div>
      <Separator />
      <div class="flex items-center justify-between gap-2">
        <span>{{ t('pages.account.details.accountCategory') }}</span>

        <div class="flex items-center gap-1.5">
          <span class="capitalize">
            {{ t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[account.accountCategory]) }}
          </span>

          <AccountCategoryEditPopover v-if="isCategoryEditable" :account="account" />
        </div>
      </div>
      <Separator />
      <div class="flex items-center justify-between gap-2">
        <span>{{ t('pages.account.details.defaultPaymentType') }}</span>

        <div class="flex items-center gap-1.5">
          <span>{{ t(defaultPaymentTypeLabelKey) }}</span>

          <AccountDefaultPaymentTypeEditPopover v-if="isOwner" :account="account" />
        </div>
      </div>
      <Separator />

      <div class="flex items-center justify-between gap-2">
        <span>{{ $t('pages.account.details.externalUrl') }}</span>

        <div class="flex min-w-0 items-center gap-1.5">
          <a
            v-if="externalUrlHref"
            :href="externalUrlHref"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-text inline-flex max-w-52 items-center gap-1 hover:underline"
          >
            <span class="truncate">{{ externalUrlLabel }}</span>
            <ExternalLinkIcon class="size-3.5 shrink-0" />
          </a>
          <span v-else class="text-muted-foreground">{{ $t('pages.account.details.externalUrlNotSet') }}</span>

          <AccountExternalUrlEditPopover v-if="isOwner" :account="account" />
        </div>
      </div>
      <Separator />

      <Collapsible.Collapsible v-model:open="isOpen">
        <Collapsible.CollapsibleTrigger class="w-full">
          <div class="flex items-center justify-between gap-2">
            <span>{{ t('pages.account.details.currency') }}</span>

            <div class="flex gap-2">
              {{ currencyCode }}

              <span v-if="currenciesMap[account.currencyCode]?.isDefaultCurrency">
                {{ t('pages.account.details.main') }}
              </span>

              <template v-if="isOpen">
                <ChevronUpIcon />
              </template>
              <template v-else>
                <ChevronDownIcon />
              </template>
            </div>
          </div>
        </Collapsible.CollapsibleTrigger>

        <Collapsible.CollapsibleContent>
          <div class="grid gap-2 pt-4 pl-4">
            <Separator />

            <div class="flex items-center justify-between gap-2">
              <span>{{ t('pages.account.details.exchangeRate') }}</span>

              {{ currenciesMap[account.currencyCode]?.exchangeRate }}
            </div>

            <Separator />

            <div class="flex items-center justify-between gap-2">
              <span>{{ t('pages.account.details.exchangeRateLiveUpdate') }}</span>

              {{
                currenciesMap[account.currencyCode]?.liveRateUpdate
                  ? t('pages.account.details.enabled')
                  : t('pages.account.details.disabled')
              }}
            </div>
          </div>
        </Collapsible.CollapsibleContent>
      </Collapsible.Collapsible>
    </div>
  </Tabs.TabsContent>
</template>
