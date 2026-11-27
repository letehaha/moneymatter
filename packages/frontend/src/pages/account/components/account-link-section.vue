<script setup lang="ts">
import { linkAccountToBankConnection } from '@/api/accounts';
import {
  type AvailableAccount,
  type BankConnection,
  getAvailableAccounts,
  listConnections,
} from '@/api/bank-data-providers';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import BankConnectionLogo from '@/components/common/bank-connection-logo.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import * as Select from '@/components/lib/ui/select';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { useFormatCurrency } from '@/composable/formatters';
import { getCurrencyDecimals, trimAmountNoise } from '@/js/helpers/currency-decimals';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { AccountModel, type LinkResidualTarget } from '@bt/shared/types';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { CheckIcon, Link2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  account: AccountModel;
}>();

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode, formatAccountAmount } = useFormatCurrency();
const accountsStore = useAccountsStore();
const queryClient = useQueryClient();

const isAccountLinkedToBank = computed(() => !!props.account.bankDataProviderConnectionId);
const isSystemAccount = computed(() => props.account.type === 'system');

// Only show for system accounts that are not yet linked
const showLinkOption = computed(() => isSystemAccount.value && !isAccountLinkedToBank.value);

// Dialog state
const isDialogOpen = ref(false);

// Form state
const selectedConnectionId = ref<string | undefined>(undefined);
const selectedExternalAccountId = ref<string | undefined>(undefined);
const isLinking = ref(false);
const residualTarget = ref<LinkResidualTarget>('adjustment');

const RESIDUAL_OPTIONS = [
  {
    value: 'adjustment',
    labelKey: 'pages.account.link.residualAdjustmentLabel',
    descriptionKey: 'pages.account.link.residualAdjustmentDescription',
  },
  {
    value: 'opening-balance',
    labelKey: 'pages.account.link.residualOpeningLabel',
    descriptionKey: 'pages.account.link.residualOpeningDescription',
  },
] as const satisfies readonly { value: LinkResidualTarget; labelKey: string; descriptionKey: string }[];

// Fetch user connections
const { data: connections, isLoading: isLoadingConnections } = useQuery<BankConnection[]>({
  queryKey: VUE_QUERY_CACHE_KEYS.bankConnections,
  queryFn: listConnections,
  enabled: showLinkOption,
});

// Fetch external accounts for selected connection
const { data: externalAccounts, isLoading: isLoadingExternalAccounts } = useQuery<AvailableAccount[]>({
  queryKey: [...VUE_QUERY_CACHE_KEYS.bankAvailableExternalAccounts, selectedConnectionId],
  queryFn: () => getAvailableAccounts(selectedConnectionId.value!),
  enabled: computed(() => !!selectedConnectionId.value),
});

const selectedConnection = computed(() => connections.value?.find((c) => String(c.id) === selectedConnectionId.value));

const hasConnections = computed(() => connections.value && connections.value.length > 0);
const hasExternalAccounts = computed(() => externalAccounts.value && externalAccounts.value.length > 0);

const canConfirmLink = computed(() => {
  return (
    !!selectedConnectionId.value && !!selectedExternalAccountId.value && !isLinking.value && !currencyMismatch.value
  );
});

const linkAccount = async () => {
  if (!canConfirmLink.value) return;

  isLinking.value = true;
  let result: Awaited<ReturnType<typeof linkAccountToBankConnection>>;
  try {
    result = await linkAccountToBankConnection({
      accountId: props.account.id,
      connectionId: selectedConnectionId.value!,
      externalAccountId: selectedExternalAccountId.value!,
      residualTarget: balanceDifference.value !== 0 ? residualTarget.value : undefined,
    });
  } catch (error) {
    if (!(error instanceof ApiErrorResponseError)) {
      captureException({ error, context: { source: 'linkAccount', accountId: props.account.id } });
    }
    addErrorNotification(error instanceof Error ? error.message : t('pages.account.link.linkFailed'));
    return;
  } finally {
    isLinking.value = false;
  }

  addSuccessNotification(result.message);
  resetForm();
  queryClient.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange);
    },
  });
  const refresh = await accountsStore.loadAccounts();
  if (refresh.isError) {
    addErrorNotification(t('pages.account.link.refreshFailed'));
    captureException({ error: refresh.error, context: { source: 'linkAccountRefresh', accountId: props.account.id } });
  }
};

const resetForm = () => {
  isDialogOpen.value = false;
  selectedConnectionId.value = undefined;
  selectedExternalAccountId.value = undefined;
  residualTarget.value = 'adjustment';
};

const selectedExternalAccount = computed(() => {
  if (!selectedExternalAccountId.value || !externalAccounts.value) return null;
  return externalAccounts.value.find((a) => a.externalId === selectedExternalAccountId.value);
});

const systemOwnFunds = computed(() => props.account.currentBalance - props.account.creditLimit);
const externalOwnFunds = computed(() =>
  selectedExternalAccount.value ? selectedExternalAccount.value.balance - selectedExternalAccount.value.creditLimit : 0,
);

const balanceDifference = computed(() =>
  selectedExternalAccount.value
    ? trimAmountNoise({
        value: externalOwnFunds.value - systemOwnFunds.value,
        decimals: getCurrencyDecimals({ code: props.account.currencyCode, meta: props.account.currencyMeta }),
      })
    : 0,
);

const currencyMismatch = computed(() => {
  if (!selectedExternalAccount.value) return false;
  return selectedExternalAccount.value.currency.toLowerCase() !== props.account.currencyCode.toLowerCase();
});

const linkingError = computed(() => {
  if (currencyMismatch.value) {
    return `Currency mismatch: System account uses ${props.account.currencyCode}, but selected external account uses ${selectedExternalAccount.value?.currency}. Please select an account with matching currency.`;
  }
  return null;
});
</script>

<template>
  <div v-if="showLinkOption" class="rounded-lg border p-5">
    <div class="mb-4 flex items-center gap-2.5">
      <div class="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-full">
        <Link2Icon class="size-4" />
      </div>
      <div>
        <p class="font-semibold">{{ $t('pages.account.link.title') }}</p>
        <p class="text-muted-foreground text-xs">{{ $t('pages.account.link.description') }}</p>
      </div>
    </div>

    <div class="mb-5 space-y-2">
      <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {{ $t('pages.account.link.whatWillHappen') }}
      </p>
      <ul class="space-y-1.5">
        <li
          v-for="key in ['listItem1', 'listItem2', 'listItem3', 'listItem4']"
          :key="key"
          class="flex items-start gap-2 text-sm"
        >
          <CheckIcon class="text-primary-text mt-0.5 size-4 shrink-0" />
          <span>{{ $t(`pages.account.link.${key}`) }}</span>
        </li>
      </ul>
    </div>

    <ResponsiveDialog v-model:open="isDialogOpen">
      <template #trigger>
        <Button class="w-full" :disabled="isLinking">
          <Link2Icon class="size-4" />
          {{ isLinking ? $t('pages.account.link.linking') : $t('pages.account.link.linkButton') }}
        </Button>
      </template>

      <template #title>{{ $t('pages.account.link.dialogTitle') }}</template>

      <template #description>{{ $t('pages.account.link.dialogDescription') }}</template>

      <div class="space-y-4">
        <!-- Select Bank Connection -->
        <div class="space-y-2">
          <Label for="connection-select">{{ $t('pages.account.link.connectionLabel') }}</Label>
          <Select.Select v-model="selectedConnectionId" :disabled="isLoadingConnections || !hasConnections">
            <Select.SelectTrigger id="connection-select">
              <Select.SelectValue :placeholder="$t('pages.account.link.selectConnection')">
                <span v-if="selectedConnection" class="flex min-w-0 items-center gap-2">
                  <BankConnectionLogo :connection-id="selectedConnection.id" size="size-5" class="rounded-sm" />
                  <span class="truncate">{{ selectedConnection.providerName }}</span>
                </span>
                <template v-else>{{ $t('pages.account.link.selectConnection') }}</template>
              </Select.SelectValue>
            </Select.SelectTrigger>
            <Select.SelectContent>
              <template v-if="isLoadingConnections">
                <Select.SelectItem disabled value="loading">{{
                  $t('pages.account.link.loadingConnections')
                }}</Select.SelectItem>
              </template>
              <template v-else-if="hasConnections">
                <Select.SelectItem v-for="conn in connections" :key="conn.id" :value="String(conn.id)">
                  <span class="flex items-center gap-2">
                    <BankConnectionLogo :connection-id="conn.id" size="size-5" class="rounded-sm" />
                    {{ conn.providerName }}
                  </span>
                </Select.SelectItem>
              </template>
              <template v-else>
                <Select.SelectItem disabled value="none">{{
                  $t('pages.account.link.noConnections')
                }}</Select.SelectItem>
              </template>
            </Select.SelectContent>
          </Select.Select>
        </div>

        <!-- Select External Account -->
        <div v-if="selectedConnectionId" class="space-y-2">
          <Label for="account-select">{{ $t('pages.account.link.accountLabel') }}</Label>
          <Select.Select
            v-model="selectedExternalAccountId"
            :disabled="isLoadingExternalAccounts || !hasExternalAccounts"
          >
            <Select.SelectTrigger id="account-select">
              <Select.SelectValue
                :placeholder="
                  isLoadingExternalAccounts
                    ? $t('pages.account.link.loading')
                    : $t('pages.account.link.selectExternalAccount')
                "
              />
            </Select.SelectTrigger>
            <Select.SelectContent>
              <template v-if="isLoadingExternalAccounts">
                <Select.SelectItem disabled value="loading">{{
                  $t('pages.account.link.loadingAccounts')
                }}</Select.SelectItem>
              </template>
              <template v-else-if="hasExternalAccounts">
                <Select.SelectItem v-for="acc in externalAccounts" :key="acc.externalId" :value="acc.externalId">
                  {{ acc.name }} ({{
                    formatAmountByCurrencyCode({ amount: acc.balance - acc.creditLimit, currencyCode: acc.currency })
                  }})
                </Select.SelectItem>
              </template>
              <template v-else>
                <Select.SelectItem disabled value="none">{{
                  $t('pages.account.link.noExternalAccounts')
                }}</Select.SelectItem>
              </template>
            </Select.SelectContent>
          </Select.Select>
        </div>

        <!-- Currency Mismatch Error -->
        <Callout v-if="linkingError" variant="destructive" :title="$t('pages.account.link.mismatchWarning')">
          <p class="mt-1 text-xs">{{ linkingError }}</p>
        </Callout>

        <!-- Balance Preview -->
        <div v-else-if="selectedExternalAccount" class="bg-muted rounded-md p-3 text-sm">
          <p class="mb-1 font-semibold">{{ $t('pages.account.link.balanceComparison') }}</p>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <p class="text-muted-foreground">{{ $t('pages.account.link.systemAccount') }}</p>
              <p class="font-mono">
                {{ formatAccountAmount({ amount: systemOwnFunds, account, fullPrecision: true }) }}
              </p>
            </div>
            <div>
              <p class="text-muted-foreground">{{ $t('pages.account.link.externalAccount') }}</p>
              <p class="font-mono">
                {{
                  formatAmountByCurrencyCode({
                    amount: externalOwnFunds,
                    currencyCode: selectedExternalAccount.currency,
                    fullPrecision: true,
                  })
                }}
              </p>
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between gap-2 border-t pt-2">
            <p class="text-muted-foreground">{{ $t('pages.account.link.difference') }}</p>
            <p
              :class="
                cn(
                  'font-mono',
                  balanceDifference < 0 && 'text-app-expense-color',
                  balanceDifference > 0 && 'text-app-income-color',
                )
              "
            >
              {{ formatAccountAmount({ amount: balanceDifference, account, fullPrecision: true }) }}
            </p>
          </div>

          <div v-if="balanceDifference !== 0" class="mt-3 space-y-2 border-t pt-3">
            <p class="font-semibold">{{ $t('pages.account.link.residualTitle') }}</p>
            <RadioGroup v-model="residualTarget" class="gap-3">
              <div v-for="option in RESIDUAL_OPTIONS" :key="option.value" class="flex items-start gap-2">
                <RadioGroupItem :id="`residual-target-${option.value}`" :value="option.value" class="mt-0.5" />
                <Label :for="`residual-target-${option.value}`" class="cursor-pointer">
                  {{ $t(option.labelKey) }}
                  <span class="text-muted-foreground mt-0.5 block text-xs font-normal">
                    {{ $t(option.descriptionKey) }}
                  </span>
                </Label>
              </div>
            </RadioGroup>
            <p class="text-muted-foreground text-xs">{{ $t('pages.account.link.residualHint') }}</p>
          </div>
        </div>
      </div>

      <template #footer="{ close }">
        <Button variant="outline" @click="close">{{ $t('common.actions.cancel') }}</Button>
        <Button :disabled="!canConfirmLink" @click="linkAccount">
          {{ isLinking ? $t('pages.account.link.linking') : $t('pages.account.link.acceptLabel') }}
        </Button>
      </template>
    </ResponsiveDialog>
  </div>
</template>
