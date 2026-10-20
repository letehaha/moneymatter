<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useUnlinkAccountFromGroup } from '@/composable/data-queries/account-groups';
import { useAccountDisplayBalance } from '@/composable/use-account-display-balance';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { AccountModel } from '@bt/shared/types';
import { UngroupIcon } from '@lucide/vue';
import { ref, toRef } from 'vue';
import { RouterLink } from 'vue-router';

import { AMOUNT_COLUMN_CLASS, HOVER_ACTIONS_CLASS } from '../row-styles';

const props = defineProps<{
  account: AccountModel;
  groupId: string;
  depth: number;
  touch: boolean;
}>();

const { formatAmountByCurrencyCode } = useFormatCurrency();

const { displayBalance } = useAccountDisplayBalance({
  account: toRef(() => props.account),
});

const isConfirmOpen = ref(false);

const { mutate: unlink, isPending } = useUnlinkAccountFromGroup({
  onSuccess: () => {
    isConfirmOpen.value = false;
  },
});
</script>

<template>
  <div class="group/row hover:bg-muted/40 flex h-9 items-center pr-3 pl-2 transition-colors">
    <span v-for="level in depth" :key="level" class="flex w-4 shrink-0 justify-center self-stretch" aria-hidden="true">
      <span class="bg-border w-px" />
    </span>
    <span class="w-4 shrink-0" aria-hidden="true" />

    <div class="ml-2 flex min-w-0 flex-1 items-center gap-2">
      <AccountLogo :account="account" class="size-4.5 rounded-full" />

      <RouterLink
        :to="{ name: ROUTES_NAMES.account, params: { id: account.id } }"
        class="focus-visible:ring-ring/40 min-w-0 truncate rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ account.name }}
      </RouterLink>

      <span v-if="!touch" :class="HOVER_ACTIONS_CLASS">
        <DesktopOnlyTooltip :content="$t('settings.accountGroups.accounts.unlinkTooltip')">
          <Button
            variant="ghost-destructive"
            size="icon-sm"
            class="size-7"
            :disabled="isPending"
            :aria-label="$t('settings.accountGroups.accounts.unlinkTooltip')"
            @click="isConfirmOpen = true"
          >
            <UngroupIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </span>
    </div>

    <span :class="cn(AMOUNT_COLUMN_CLASS, 'text-muted-foreground text-sm tabular-nums')">
      {{ formatAmountByCurrencyCode(displayBalance, account.currencyCode) }}
    </span>

    <Button
      v-if="touch"
      variant="ghost-destructive"
      size="icon-sm"
      class="ml-1 size-7 shrink-0"
      :disabled="isPending"
      :aria-label="$t('settings.accountGroups.accounts.unlinkTooltip')"
      @click="isConfirmOpen = true"
    >
      <UngroupIcon class="size-4" />
    </Button>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-label="$t('settings.accountGroups.accounts.removeConfirmAction')"
      confirm-variant="destructive"
      :confirm-disabled="isPending"
      @confirm="unlink({ accountId: account.id, groupId })"
    >
      <template #title>
        {{
          $t('settings.accountGroups.accounts.removeConfirmTitle', {
            name: account.name,
          })
        }}
      </template>

      <template #description>
        {{ $t('settings.accountGroups.accounts.removeConfirmDescription') }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
