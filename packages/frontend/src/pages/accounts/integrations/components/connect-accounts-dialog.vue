<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="max-w-xl">
    <template #title>{{ $t('pages.integrations.details.fetchAccountsDialog.title') }}</template>
    <template #description>
      {{ $t('pages.integrations.details.fetchAccountsDialog.description', { providerName }) }}
    </template>

    <div class="flex flex-col gap-4">
      <Popover.Popover>
        <Popover.PopoverTrigger class="text-primary-text flex cursor-pointer items-center gap-2 text-sm">
          {{ $t('pages.integrations.details.fetchAccountsDialog.missingAccountsQuestion') }}
          <InfoIcon class="size-4" />
        </Popover.PopoverTrigger>
        <Popover.PopoverContent class="max-w-[320px]">
          <i18n-t
            keypath="pages.integrations.details.fetchAccountsDialog.missingAccountsHint"
            tag="p"
            class="text-sm leading-6"
          >
            <template #section>
              <strong>{{ $t('pages.integrations.details.fetchAccountsDialog.missingAccountsSectionName') }}</strong>
            </template>
            <template #button>
              <strong>{{ $t('pages.integrations.details.fetchAccountsDialog.missingAccountsButtonName') }}</strong>
            </template>
          </i18n-t>
          <p class="text-muted-foreground mt-2 text-sm">
            {{ $t('pages.integrations.details.fetchAccountsDialog.missingAccountsPersist') }}
          </p>
        </Popover.PopoverContent>
      </Popover.Popover>

      <div v-if="isLoading" class="flex flex-col gap-2" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="bg-muted h-14.5 animate-pulse rounded-lg" />
      </div>

      <div v-else-if="errorType" class="border-destructive text-destructive-text rounded-lg border p-4 text-sm">
        <p v-if="errorType === 'forbidden'">
          {{ $t('pages.integrations.details.fetchAccountsDialog.sessionExpired') }}
        </p>
        <p v-else>{{ $t('pages.integrations.details.fetchAccountsDialog.loadFailed') }}</p>
      </div>

      <p v-else-if="accounts && accounts.length === 0" class="text-muted-foreground py-8 text-center text-sm">
        {{ $t('pages.integrations.details.fetchAccountsDialog.noAdditionalAccounts') }}
      </p>

      <template v-else-if="accounts">
        <div v-if="selectableAccounts.length" class="flex flex-col gap-2">
          <div class="flex min-h-8 items-center justify-between gap-2">
            <div class="flex items-baseline gap-1.5">
              <span class="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                {{ $t('pages.integrations.common.availableLabel') }}
              </span>
              <span class="text-muted-foreground/70 text-xs font-medium tabular-nums">
                {{ selectableAccounts.length }}
              </span>
            </div>
            <UiButton variant="ghost-primary" size="sm" :disabled="isConnecting" @click="toggleAll">
              {{ allSelected ? $t('pages.integrations.common.clearAll') : $t('pages.integrations.common.selectAll') }}
            </UiButton>
          </div>

          <AccountSelectionRow
            v-for="account in selectableAccounts"
            :key="account.externalId"
            :account="account"
            :provider-type="providerType"
            :selected="isSelected(account.externalId)"
            :disabled="isConnecting"
            :meta="secondaryMeta(account)"
            :currency-override="currencyOverrides[account.externalId] ?? null"
            @toggle="toggle(account.externalId)"
            @update:currency-override="(code) => setCurrencyOverride({ externalId: account.externalId, code })"
          />

          <p v-if="missingCurrencyCount > 0" class="text-warning-text flex items-start gap-2 text-xs">
            <TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0" />
            {{ $t('pages.integrations.common.currencyPicker.missingCount', missingCurrencyCount) }}
          </p>
        </div>

        <p v-else class="text-muted-foreground py-4 text-center text-sm">
          {{ $t('pages.integrations.details.fetchAccountsDialog.noAdditionalAccounts') }}
        </p>

        <Collapsible v-if="connectedAccounts.length" v-slot="{ open }">
          <CollapsibleTrigger
            class="text-muted-foreground flex items-center gap-2 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase"
          >
            <ChevronRightIcon :class="cn('size-3.5 transition-transform', open && 'rotate-90')" />
            {{ $t('pages.integrations.details.fetchAccountsDialog.alreadyConnected') }}
            <span class="text-muted-foreground/70 font-medium tracking-normal tabular-nums">
              {{ connectedAccounts.length }}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="flex flex-col gap-1.5 pt-1.5">
              <div
                v-for="account in connectedAccounts"
                :key="account.externalId"
                class="bg-card text-muted-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
              >
                <span class="bg-success-text size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                <AccountVisualChip :account="account" :provider-type="providerType" />
                <span class="min-w-0 flex-1 truncate">{{ account.name }}</span>
                <span class="shrink-0 text-xs whitespace-nowrap tabular-nums">
                  {{ formatAmountByCurrencyCode({ amount: account.balance, currencyCode: account.currency }) }}
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
    </div>

    <template #footer="{ close }">
      <div class="grid w-full gap-3 sm:grid-cols-2">
        <UiButton variant="outline" @click="close">{{ $t('common.actions.cancel') }}</UiButton>
        <UiButton
          :disabled="isConnecting || selectedIds.length === 0 || isMissingCurrencySelection"
          @click="emitConnect"
        >
          <Loader2Icon v-if="isConnecting" class="size-4 animate-spin" />
          {{
            selectedIds.length
              ? $t('pages.integrations.details.fetchAccountsDialog.connectSelectedButton', selectedIds.length)
              : $t('pages.integrations.details.fetchAccountsDialog.selectAccountsButton')
          }}
        </UiButton>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<script lang="ts" setup>
import type { AvailableAccount } from '@/api/bank-data-providers';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useFormatCurrency } from '@/composable';
import * as Popover from '@/components/lib/ui/popover';
import { cn } from '@/lib/utils';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { ChevronRightIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatIbanCompact, getAccountSecondaryMeta } from '../utils/account-visual';
import { applyCurrencyOverride, countMissingCurrencySelections } from '../utils/currency-overrides';
import AccountSelectionRow from './account-selection-row.vue';
import AccountVisualChip from './account-visual-chip.vue';

const props = defineProps<{
  open: boolean;
  accounts: AvailableAccount[] | undefined;
  isLoading: boolean;
  errorType: 'forbidden' | 'generic' | null;
  connectedExternalIds: Set<string>;
  providerName: string;
  providerType: BANK_PROVIDER_TYPE | undefined;
  isConnecting: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  connect: [payload: { externalIds: string[]; currencyOverrides: Record<string, string> }];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const selectedIds = ref<string[]>([]);
// externalId → user-picked currency for accounts listed without one (NO_CURRENCY_CODE).
const currencyOverrides = ref<Record<string, string>>({});

const setCurrencyOverride = ({ externalId, code }: { externalId: string; code: string | null }) => {
  currencyOverrides.value = applyCurrencyOverride({ overrides: currencyOverrides.value, externalId, code });
};

// Selected no-currency accounts without a picked currency block the connect.
const missingCurrencyCount = computed(() =>
  countMissingCurrencySelections({
    accounts: selectableAccounts.value,
    selectedIds: selectedIds.value,
    overrides: currencyOverrides.value,
  }),
);
const isMissingCurrencySelection = computed(() => missingCurrencyCount.value > 0);

const emitConnect = () => {
  if (isMissingCurrencySelection.value) return;
  emit('connect', { externalIds: selectedIds.value, currencyOverrides: currencyOverrides.value });
};

const selectableAccounts = computed(
  () => props.accounts?.filter((account) => !props.connectedExternalIds.has(account.externalId)) ?? [],
);
const connectedAccounts = computed(
  () => props.accounts?.filter((account) => props.connectedExternalIds.has(account.externalId)) ?? [],
);

const isSelected = (externalId: string) => selectedIds.value.includes(externalId);

const toggle = (externalId: string) => {
  if (props.isConnecting) return;
  selectedIds.value = isSelected(externalId)
    ? selectedIds.value.filter((id) => id !== externalId)
    : [...selectedIds.value, externalId];
};

const allSelected = computed(
  () => selectableAccounts.value.length > 0 && selectedIds.value.length === selectableAccounts.value.length,
);

const toggleAll = () => {
  if (props.isConnecting) return;
  selectedIds.value = allSelected.value ? [] : selectableAccounts.value.map((account) => account.externalId);
};

const { formatAmountByCurrencyCode } = useFormatCurrency();

const secondaryMeta = (account: AvailableAccount): string | null => {
  const { iban } = getAccountSecondaryMeta({ metadata: account.metadata });
  if (account.creditLimit > 0) {
    return t('pages.integrations.details.fetchAccountsDialog.creditLimitMeta', {
      amount: formatAmountByCurrencyCode({ amount: account.creditLimit, currencyCode: account.currency }),
    });
  }
  if (iban) return formatIbanCompact({ iban });
  if (props.providerType !== BANK_PROVIDER_TYPE.MONOBANK) return account.type;
  return null;
};

watch(isOpen, (open) => {
  if (!open) {
    selectedIds.value = [];
    currencyOverrides.value = {};
  }
});
</script>
