<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import PortfolioTransferDialog from '@/components/dialogs/portfolio-transfer-dialog.vue';
import ShareAccountDialog from '@/components/dialogs/share-account-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { CardHeader } from '@/components/lib/ui/card';
import * as Popover from '@/components/lib/ui/popover';
import * as Tooltip from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import { useAccountAccess } from '@/composable/use-account-access';
import { useAccountProjectedBalance, usePlannedDateLabel } from '@/composable/use-projected-balance';
import { toLocalCurrencyNumber } from '@/js/helpers';
import * as validators from '@/js/helpers/validators';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { ACCOUNT_TYPES, AccountModel, SHARE_PERMISSIONS, TRANSACTIONS_WRITE_SCOPES } from '@bt/shared/types';
import { ArrowRightLeftIcon, MoreVerticalIcon, PencilIcon, ScaleIcon, Share2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import AccountLogoPicker from './account-logo-picker.vue';
import BalanceAdjustmentDialog from './balance-adjustment-dialog.vue';

const props = defineProps<{
  account: AccountModel;
}>();
const { currenciesMap, baseCurrency } = storeToRefs(useCurrenciesStore());
const { displayBalance, displayRefBalance, projectedBalance, plannedCount, latestPlannedTime, hasPendingPlans } =
  useAccountProjectedBalance({ account: toRef(() => props.account) });
const accountsStore = useAccountsStore();
const formEditingPopoverOpen = ref(false);
const adjustmentDialogOpen = ref(false);
const shareDialogOpen = ref(false);
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

const isSystemAccount = computed(() => props.account.type === ACCOUNT_TYPES.system);

const { formatPlannedDate } = usePlannedDateLabel();

const projectedBalanceDisplay = computed(() =>
  toLocalCurrencyNumber(projectedBalance.value, { currency: props.account.currencyCode }),
);
const latestPlannedDisplay = computed(() => formatPlannedDate({ time: latestPlannedTime.value }));
const { isOwner, isSharedWithCaller, ownerHandle, permission, writeScope, isHouseholdGranted } = useAccountAccess(
  toRef(() => props.account),
);

const permissionBadgeLabel = computed(() => {
  if (!isSharedWithCaller.value) return null;
  if (permission.value === SHARE_PERMISSIONS.manage) return t('pages.account.header.shareBadge.manage');
  if (permission.value === SHARE_PERMISSIONS.write) {
    return writeScope.value === TRANSACTIONS_WRITE_SCOPES.own
      ? t('pages.account.header.shareBadge.writeOwn')
      : t('pages.account.header.shareBadge.writeAll');
  }
  return t('pages.account.header.shareBadge.read');
});

const accountNameForm = ref({
  name: props.account.name,
});
const { isFormValid, touchField, getFieldErrorMessage, resetValidation } = useFormValidation(
  { form: accountNameForm },
  {
    form: {
      name: {
        required: validators.required,
        minLength: validators.minLength(2),
      },
    },
  },
);

/**
 * Guard to prevent the dropdown's dismiss cascade from immediately
 * closing the popover. When the dropdown closes it fires pointer /
 * focus-outside events that the Popover picks up via @update:open.
 */
let openedFromDropdownAt = 0;

const openRenameFromDropdown = () => {
  openedFromDropdownAt = Date.now();
  formEditingPopoverOpen.value = true;
};

const onPopoverOpenChange = (value: boolean) => {
  if (!value && Date.now() - openedFromDropdownAt < 200) return;
  formEditingPopoverOpen.value = value;
};

const updateAccount = async () => {
  if (!isFormValid()) return;

  try {
    await accountsStore.editAccount({
      id: props.account.id,
      name: accountNameForm.value.name,
    });

    formEditingPopoverOpen.value = false;
    addSuccessNotification(t('pages.account.header.updateSuccess'));
  } catch {
    addErrorNotification(t('pages.account.header.updateError'));
  }
};

// Reset form when popover opens or when account changes
watch([formEditingPopoverOpen, () => props.account.id], () => {
  accountNameForm.value.name = props.account.name;
  resetValidation();
});
</script>

<template>
  <CardHeader>
    <div class="flex flex-col">
      <div class="flex w-full justify-between gap-4">
        <div class="flex min-w-0 items-center gap-3">
          <!-- Account logo — hover reveals the edit affordance (owner only) -->
          <AccountLogoPicker v-if="isOwner" :account-id="account.id" class="size-10" />
          <AccountLogo v-else :account="account" class="size-10" />

          <!-- Account name — click to open rename popover (owner only) -->
          <Popover.Popover v-if="isOwner" :open="formEditingPopoverOpen" @update:open="onPopoverOpenChange">
            <Popover.PopoverTrigger as-child>
              <button class="flex min-w-0 cursor-pointer text-xl transition-opacity hover:opacity-80">
                <span class="truncate">{{ account.name }}</span>
              </button>
            </Popover.PopoverTrigger>
            <Popover.PopoverContent>
              <form class="grid gap-6" @submit.prevent="updateAccount">
                <InputField
                  v-model="accountNameForm.name"
                  :label="$t('pages.account.header.nameLabel')"
                  :placeholder="$t('pages.account.header.namePlaceholder')"
                  :error-message="getFieldErrorMessage('form.name')"
                  @blur="touchField('form.name')"
                />

                <Button type="submit" :disabled="accountNameForm.name === account.name || !accountNameForm.name.trim()">
                  {{ t('pages.account.header.save') }}
                </Button>
              </form>
            </Popover.PopoverContent>
          </Popover.Popover>
          <div v-else class="flex min-w-0 items-center gap-2 text-xl">
            <span class="truncate">{{ account.name }}</span>
          </div>
        </div>

        <div class="flex gap-2">
          <PortfolioTransferDialog v-if="isOwner" :account="account" context="account">
            <Button variant="ghost" size="icon" :title="t('pages.account.header.transferToPortfolio')">
              <ArrowRightLeftIcon :size="20" />
            </Button>
          </PortfolioTransferDialog>

          <!-- Kebab dropdown — recipients have no actions here (rename/adjust/share are owner-only) -->
          <DropdownMenu v-if="isOwner">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" :title="t('pages.account.header.accountActions')">
                <MoreVerticalIcon :size="20" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem class="gap-2" @click="openRenameFromDropdown">
                <PencilIcon class="size-4" />
                {{ t('pages.account.header.renameAccount') }}
              </DropdownMenuItem>

              <Tooltip.TooltipProvider>
                <Tooltip.Tooltip :delay-duration="0">
                  <Tooltip.TooltipTrigger as-child>
                    <span class="block">
                      <DropdownMenuItem
                        class="gap-2"
                        :disabled="!isSystemAccount"
                        :class="!isSystemAccount ? 'pointer-events-none' : ''"
                        @click="isSystemAccount && (adjustmentDialogOpen = true)"
                      >
                        <ScaleIcon class="size-4" />
                        {{ t('pages.account.header.adjustBalance') }}
                      </DropdownMenuItem>
                    </span>
                  </Tooltip.TooltipTrigger>
                  <Tooltip.TooltipContent v-if="!isSystemAccount">
                    {{ t('pages.account.header.adjustBalanceTooltip') }}
                  </Tooltip.TooltipContent>
                </Tooltip.Tooltip>
              </Tooltip.TooltipProvider>

              <DropdownMenuItem class="gap-2" @click="shareDialogOpen = true">
                <Share2Icon class="size-4" />
                {{ t('pages.account.header.share') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        v-if="isSharedWithCaller && ownerHandle"
        class="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm"
      >
        <span v-if="isHouseholdGranted">{{ $t('accounts.viaHousehold', { handle: `@${ownerHandle}` }) }}</span>
        <span v-else>{{ $t('accounts.sharedBy', { handle: `@${ownerHandle}` }) }}</span>
        <span
          v-if="permissionBadgeLabel"
          class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium"
        >
          {{ permissionBadgeLabel }}
        </span>
      </div>

      <!-- Balance -->
      <div class="flex items-center">
        <button
          v-if="isSystemAccount && isOwner"
          class="flex cursor-pointer flex-wrap items-end justify-start gap-x-2 transition-opacity hover:opacity-75"
          @click="adjustmentDialogOpen = true"
        >
          <span class="text-amount text-3xl">
            {{ toLocalCurrencyNumber(displayBalance, { currency: account.currencyCode }) }}
            {{ currenciesMap[account.currencyCode]?.currency?.code }}
          </span>
          <span v-if="baseCurrency && account.currencyCode !== baseCurrency.currencyCode" class="text-white opacity-50">
            ~
            {{ toLocalCurrencyNumber(displayRefBalance, { currency: baseCurrency.currencyCode }) }}
            {{ baseCurrency.currency?.code }}
          </span>
        </button>
        <div v-else class="flex flex-wrap items-end justify-start gap-2">
          <span class="text-amount text-3xl">
            {{ toLocalCurrencyNumber(displayBalance, { currency: account.currencyCode }) }}
            {{ currenciesMap[account.currencyCode]?.currency?.code }}
          </span>
          <span v-if="baseCurrency && account.currencyCode !== baseCurrency.currencyCode" class="text-white opacity-50">
            ~
            {{ toLocalCurrencyNumber(displayRefBalance, { currency: baseCurrency.currencyCode }) }}
            {{ baseCurrency.currency?.code }}
          </span>
        </div>
      </div>

      <i18n-t
        v-if="hasPendingPlans"
        keypath="pages.account.header.projectedBalance"
        :plural="plannedCount"
        tag="div"
        class="text-muted-foreground mt-1 text-sm"
      >
        <template #amount>
          <span class="text-amount text-foreground">{{ projectedBalanceDisplay }}</span>
        </template>
        <template #count>{{ plannedCount }}</template>
        <template #date>{{ latestPlannedDisplay }}</template>
      </i18n-t>
    </div>

    <BalanceAdjustmentDialog v-if="adjustmentDialogOpen" :account="account" @close="adjustmentDialogOpen = false" />
    <ShareAccountDialog v-model:open="shareDialogOpen" :account="account" />
  </CardHeader>
</template>
