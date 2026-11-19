<template>
  <Popover.Popover v-if="accountsNeedingRelink.length > 0">
    <Popover.PopoverTrigger as-child>
      <Button variant="destructive" :size="isCompactView ? 'icon-sm' : 'sm'">
        <AlertTriangleIcon class="size-4" />
        <span class="hidden lg:inline">{{ $t('relinkWarning.buttonLabel', accountsNeedingRelink.length) }}</span>
      </Button>
    </Popover.PopoverTrigger>
    <Popover.PopoverContent class="w-96" align="end">
      <div class="space-y-4">
        <div class="space-y-2">
          <h4 class="text-sm font-semibold">{{ $t('relinkWarning.title') }}</h4>
          <p class="text-muted-foreground text-xs">
            {{ $t('relinkWarning.description') }}
          </p>
        </div>

        <Separator.Separator />

        <div class="space-y-3">
          <div class="space-y-2">
            <div class="flex gap-2">
              <span
                class="bg-primary/10 text-primary-text flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium"
              >
                1
              </span>
              <i18n-t keypath="relinkWarning.step1Full" tag="p" class="text-muted-foreground text-xs">
                <template #reconnect>
                  <span class="text-foreground font-medium">"{{ $t('relinkWarning.reconnectButton') }}"</span>
                </template>
                <template #connectionValidity>
                  <span class="text-foreground font-medium">"{{ $t('relinkWarning.connectionValiditySection') }}"</span>
                </template>
              </i18n-t>
            </div>
            <!-- Connection links -->
            <div class="ml-7 flex flex-wrap gap-1">
              <router-link
                v-for="connectionId in uniqueConnectionIds"
                :key="connectionId"
                :to="{ name: ROUTES_NAMES.accountIntegrationDetails, params: { connectionId } }"
                class="bg-primary/10 text-primary-text hover:bg-primary/20 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
              >
                <ExternalLinkIcon class="size-3" />
                {{ $t('relinkWarning.connectionLabel', { id: connectionId }) }}
              </router-link>
            </div>
          </div>

          <div class="flex gap-2">
            <span
              class="bg-primary/10 text-primary-text flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium"
            >
              2
            </span>
            <i18n-t keypath="relinkWarning.step2Full" tag="p" class="text-muted-foreground text-xs">
              <template #unlink>
                <span class="text-foreground font-medium">{{ $t('relinkWarning.unlinkAction') }}</span>
              </template>
              <template #link>
                <span class="text-foreground font-medium">{{ $t('relinkWarning.linkAction') }}</span>
              </template>
            </i18n-t>
          </div>
        </div>

        <Separator.Separator />

        <div class="max-h-50 space-y-2 overflow-auto pr-4">
          <router-link
            v-for="account in accountsNeedingRelink"
            :key="account.id"
            :to="{ name: ROUTES_NAMES.account, params: { id: account.id } }"
            class="hover:bg-hover flex items-center gap-3 rounded-md p-2 transition-colors"
          >
            <div
              class="bg-warning/20 text-warning-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
            >
              <LinkIcon class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ account.name }}</p>
              <p class="text-muted-foreground text-xs">{{ account.currencyCode }}</p>
            </div>
            <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
          </router-link>
        </div>
      </div>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>

<script setup lang="ts">
import Button from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import * as Separator from '@/components/lib/ui/separator';
import { useSyncStatus } from '@/composable/use-sync-status';
import { useWindowBreakpoints } from '@/composable/window-breakpoints';
import { ROUTES_NAMES } from '@/routes';
import { useAccountsStore } from '@/stores/accounts';
import { AlertTriangleIcon, ChevronRightIcon, ExternalLinkIcon, LinkIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';

// 1024px (lg breakpoint) - used for compact header elements
const isCompactView = useWindowBreakpoints(1024);

const accountsStore = useAccountsStore();
const { accountsNeedingRelink } = storeToRefs(accountsStore);

// Get unique connection IDs from accounts needing relink
const uniqueConnectionIds = computed(() => {
  const ids = new Set<string>();
  for (const account of accountsNeedingRelink.value) {
    if (account.bankDataProviderConnectionId) {
      ids.add(account.bankDataProviderConnectionId);
    }
  }
  return Array.from(ids);
});

const syncStatus = useSyncStatus();

// Refetch accounts after sync completes to update the relink status
watch(syncStatus.isSyncing, (isSyncing, wasSyncing) => {
  if (wasSyncing && !isSyncing) {
    // Sync just completed, wait 2 seconds then refetch accounts
    setTimeout(() => {
      accountsStore.refetchAccounts();
    }, 2000);
  }
});
</script>
