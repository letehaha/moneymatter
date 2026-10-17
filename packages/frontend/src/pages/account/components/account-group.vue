<script setup lang="ts">
import AccountGroupName from '@/components/common/account-group-name.vue';
import LinkAccountGroup from '@/components/dialogs/account-groups/link-account-group-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Tooltip from '@/components/lib/ui/tooltip';
import { useAccountGroupForAccount, useAccountGroupPaths } from '@/composable/data-queries/account-groups';
import { AccountModel } from '@bt/shared/types';
import { EditIcon, InfoIcon } from '@lucide/vue';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  account: AccountModel;
}>();

const accId = ref<string>(props.account.id);

const { group: accountGroupData } = useAccountGroupForAccount(accId);
const { pathById: groupPathById } = useAccountGroupPaths();

watch(
  () => props.account.id,
  (newAccountId) => {
    accId.value = newAccountId;
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <p class="flex items-center gap-2">
      {{ t('pages.account.group.label') }}

      <Tooltip.TooltipProvider>
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger>
            <InfoIcon class="text-primary-text size-4" />
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent class="max-w-[400px] p-4">
            <span class="text-sm leading-6 opacity-90">
              {{ t('pages.account.group.tooltip') }}
            </span>
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
      </Tooltip.TooltipProvider>
    </p>

    <div class="flex items-center gap-2">
      <template v-if="accountGroupData">
        <AccountGroupName :group="accountGroupData">{{
          groupPathById.get(accountGroupData.id) ?? accountGroupData.name
        }}</AccountGroupName>
      </template>
      <template v-else>
        <span>{{ t('pages.account.group.notAssociated') }}</span>
      </template>
      <LinkAccountGroup :account="account">
        <UiButton size="icon" variant="secondary">
          <span class="flex items-center gap-3">
            <EditIcon class="size-5" />
          </span>
        </UiButton>
      </LinkAccountGroup>
    </div>
  </div>
</template>
