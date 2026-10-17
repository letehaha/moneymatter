<template>
  <RouterLink
    :to="{ name: ROUTES_NAMES.account, params: { id: account.id } }"
    :class="
      cn(
        'grid grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 px-4 py-3',
        'hover:bg-muted/40 focus-visible:ring-ring/40 transition-colors focus-visible:ring-2 focus-visible:outline-none',
      )
    "
  >
    <div class="flex min-w-0 items-center gap-3">
      <AccountLogo :account="account" :category="category" class="size-9" />
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-1.5">
          <DesktopOnlyTooltip
            v-if="isSharedWithCaller"
            :content="
              isHouseholdGranted
                ? $t('sidebar.accountsView.viaHousehold', { handle: `@${ownerHandle}` })
                : $t('sidebar.accountsView.sharedBy', { handle: `@${ownerHandle}` })
            "
          >
            <component
              :is="isHouseholdGranted ? HomeIcon : UsersIcon"
              class="text-muted-foreground size-3.5 shrink-0"
            />
          </DesktopOnlyTooltip>
          <span class="truncate text-sm font-semibold">{{ account.name }}</span>
          <DesktopOnlyTooltip v-if="needsReauth" :content="$t('sidebar.accountsView.needsReauthTooltip')">
            <TriangleAlertIcon class="text-destructive-text size-3.5 shrink-0" />
          </DesktopOnlyTooltip>
        </div>
        <div class="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1 text-xs">
          <template v-if="subtitle">
            <span class="truncate">{{ subtitle }}</span>
          </template>
          <template v-else>
            <span class="min-w-0 truncate">{{ categoryLabel }} ·</span>
            <img
              v-if="currencyFlagUrl && !flagFailed"
              :src="currencyFlagUrl"
              :alt="account.currencyCode"
              class="size-3.5 shrink-0 rounded-[2px]"
              loading="lazy"
              @error="flagFailed = true"
            />
            <span class="shrink-0">{{ account.currencyCode }}</span>
          </template>
        </div>
      </div>
    </div>

    <div class="text-right">
      <div
        class="text-sm font-semibold tabular-nums"
        :class="displayBalance < 0 ? 'text-destructive-text' : 'text-foreground'"
      >
        {{ formatAmountByCurrencyCode(displayBalance, account.currencyCode, account.currencyMeta) }}
      </div>
      <div
        v-if="account.currencyCode !== baseCurrencyCode"
        class="text-muted-foreground mt-0.5 text-[11px] tabular-nums"
      >
        <template v-if="account.refCurrentBalance === null">{{
          $t('common.transactions.record.missingRate')
        }}</template>
        <template v-else>≈ {{ formatBaseCurrency(displayRefBalance) }}</template>
      </div>
    </div>

    <ChevronRightIcon class="text-muted-foreground size-3.5" aria-hidden="true" />
  </RouterLink>
</template>

<script setup lang="ts">
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const/account-categories-verbose';
import AccountLogo from '@/components/common/account-logo.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useAccountAccess } from '@/composable/use-account-access';
import { useAccountDisplayBalance } from '@/composable/use-account-display-balance';
import { useSyncStatus } from '@/composable/use-sync-status';
import { getCurrencyIcon } from '@/js/helpers/currencyImage';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCurrenciesStore } from '@/stores';
import { ACCOUNT_CATEGORIES, AccountModel } from '@bt/shared/types';
import { ChevronRightIcon, HomeIcon, TriangleAlertIcon, UsersIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

const props = defineProps<{
  account: AccountModel;
  subtitle?: string;
  categoryOverride?: ACCOUNT_CATEGORIES;
}>();

const { t } = useI18n();
const { formatAmountByCurrencyCode, formatBaseCurrency } = useFormatCurrency();

const { baseCurrency } = storeToRefs(useCurrenciesStore());
const baseCurrencyCode = computed(() => baseCurrency.value?.currency?.code);

const { displayBalance, displayRefBalance } = useAccountDisplayBalance({ account: toRef(() => props.account) });
const { isSharedWithCaller, isHouseholdGranted, ownerHandle } = useAccountAccess(toRef(() => props.account));
const { isAccountNeedingReauth } = useSyncStatus();

const category = computed(() => props.categoryOverride ?? props.account.accountCategory);

const categoryLabel = computed(() => t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[category.value]));

// Small currency flag before the code (Wise CDN, same source as the currencies page).
// Flag-less currencies (e.g. crypto) 404 and hide via @error, leaving just the code.
const flagFailed = ref(false);
const currencyFlagUrl = computed(() => (props.account.currencyCode ? getCurrencyIcon(props.account.currencyCode) : ''));

const needsReauth = computed(() => isAccountNeedingReauth(props.account));
</script>
