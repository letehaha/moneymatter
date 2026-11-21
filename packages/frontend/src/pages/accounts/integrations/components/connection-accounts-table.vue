<template>
  <div class="border-border bg-card @container/accounts overflow-hidden rounded-xl border">
    <div v-if="accounts.length === 0" class="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div class="bg-muted flex size-12 items-center justify-center rounded-full">
        <WalletIcon class="text-muted-foreground size-6" />
      </div>
      <p class="text-muted-foreground text-sm">{{ $t('pages.integrations.details.connectedAccounts.empty') }}</p>
      <UiButton size="sm" @click="emit('connectRemaining')">
        {{ $t('pages.integrations.details.connectedAccounts.connectButton') }}
      </UiButton>
    </div>

    <template v-else>
      <div
        class="text-muted-foreground border-border bg-muted/30 hidden h-9 grid-cols-[minmax(0,1fr)_200px_150px] items-center gap-4 border-b px-4 text-[11px] font-semibold tracking-[0.08em] uppercase @2xl/accounts:grid"
      >
        <div>{{ $t('pages.integrations.details.connectedAccounts.columnAccount') }}</div>
        <div>{{ $t('pages.integrations.details.connectedAccounts.columnExternalId') }}</div>
        <div class="text-right">{{ $t('pages.integrations.details.connectedAccounts.columnBalance') }}</div>
      </div>

      <div
        v-for="account in sortedAccounts"
        :key="account.id"
        class="border-border/60 hover:bg-hover relative grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b px-4 py-2 transition-colors @2xl/accounts:grid-cols-[minmax(0,1fr)_200px_150px] @2xl/accounts:gap-y-0 @2xl/accounts:py-0"
      >
        <router-link
          class="absolute inset-0"
          :to="{ name: ROUTES_NAMES.account, params: { id: account.id } }"
          :aria-label="account.name"
        />

        <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
          <AccountLogo v-if="storeAccount(account.id)" :account="storeAccount(account.id)!" class="size-8 shrink-0" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-sm font-semibold">{{ account.name }}</span>

            <DesktopOnlyTooltip
              v-if="account.currencyFallback"
              content-class-name="max-w-xs text-wrap"
              :content="
                $t('pages.integrations.details.connectedAccounts.currencyFallback', {
                  currency: account.currencyFallback.assignedCurrency,
                })
              "
            >
              <span
                class="border-warning/25 bg-warning/10 text-warning-text relative inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium pointer-coarse:pointer-events-none"
              >
                <TriangleAlertIcon class="size-3" />
                {{
                  $t('pages.integrations.details.connectedAccounts.currencyFallbackChip', {
                    currency: account.currencyFallback.assignedCurrency,
                  })
                }}
              </span>
            </DesktopOnlyTooltip>
          </div>
        </div>

        <ClickToCopy
          :value="account.externalId"
          :label="abbreviateExternalId(account.externalId)"
          class="text-muted-foreground relative col-start-1 row-start-2 max-w-full bg-transparent px-0 py-0 hover:bg-transparent @2xl/accounts:col-start-2 @2xl/accounts:row-start-1"
        />

        <div
          class="col-start-2 row-span-2 row-start-1 self-center text-right text-sm font-semibold whitespace-nowrap tabular-nums @2xl/accounts:col-start-3 @2xl/accounts:row-span-1"
        >
          {{ toLocalCurrencyNumber(account.currentBalance, { currency: account.currencyCode }) }}
          <span class="text-muted-foreground text-xs font-normal">{{ account.currencyCode }}</span>
        </div>
      </div>

      <div v-if="remainingCount" class="p-2">
        <UiButton
          variant="ghost"
          size="lg"
          class="text-primary-text w-full justify-center rounded-lg border border-dashed px-4"
          @click="emit('connectRemaining')"
        >
          <PlusIcon class="size-4" />
          {{ $t('pages.integrations.details.connectedAccounts.connectRemainingWithCount', { count: remainingCount }) }}
        </UiButton>
      </div>

      <div
        class="border-border/60 text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-3 text-xs tabular-nums"
      >
        <span>
          {{ $t('pages.integrations.details.summary.accountsCount', accounts.length) }}
          <template v-if="needsAttentionCount">
            ·
            <span class="text-warning-text">
              {{ $t('pages.integrations.details.connectedAccounts.needsAttention', needsAttentionCount) }}
            </span>
          </template>
        </span>
        <i18n-t
          v-if="totalLabel"
          keypath="pages.integrations.details.connectedAccounts.totalLabel"
          tag="span"
          class="text-muted-foreground text-xs font-normal"
        >
          <template #amount>
            <span class="text-foreground text-sm font-semibold">{{ totalLabel }}</span>
          </template>
        </i18n-t>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import type { getConnectionDetails } from '@/api/bank-data-providers';
import AccountLogo from '@/components/common/account-logo.vue';
import ClickToCopy from '@/components/common/click-to-copy.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { toLocalCurrencyNumber } from '@/js/helpers';
import { ROUTES_NAMES } from '@/routes';
import { useAccountsStore } from '@/stores';
import { PlusIcon, TriangleAlertIcon, WalletIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

type ConnectionAccount = Awaited<ReturnType<typeof getConnectionDetails>>['accounts'][number];

const props = defineProps<{
  accounts: ConnectionAccount[];
  /** Connect-remaining row renders only for a known positive count; null = still loading/unknown, hidden. */
  remainingCount?: number | null;
  needsAttentionCount?: number;
  /** Pre-formatted base-currency total for the footer; null hides it. */
  totalLabel?: string | null;
}>();

const emit = defineEmits<{ connectRemaining: [] }>();

const { accountsRecord } = storeToRefs(useAccountsStore());
const storeAccount = (id: string) => accountsRecord.value[id];

// Sort in the base currency so mixed-currency accounts compare fairly.
const sortedAccounts = computed(() =>
  [...props.accounts].sort((a, b) => {
    const balanceOf = (account: ConnectionAccount) =>
      storeAccount(account.id)?.refCurrentBalance ?? account.currentBalance;
    return balanceOf(b) - balanceOf(a);
  }),
);

// Provider IDs share a long identical prefix, so only the tail distinguishes them.
const ABBREVIATED_ID_TAIL_LENGTH = 10;
const abbreviateExternalId = (id: string) =>
  id.length > ABBREVIATED_ID_TAIL_LENGTH + 2 ? `…${id.slice(-ABBREVIATED_ID_TAIL_LENGTH)}` : id;
</script>
