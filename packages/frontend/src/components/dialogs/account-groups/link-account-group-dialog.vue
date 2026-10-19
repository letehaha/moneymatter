<script setup lang="ts">
import { loadAccountGroups } from '@/api/account-groups';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { AccountGroups } from '@/common/types/models';
import GroupLogo from '@/components/common/group-logo.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import {
  useAccountGroupForAccount,
  useLinkAccountToGroup,
  useUnlinkAccountFromGroup,
} from '@/composable/data-queries/account-groups';
import { cn } from '@/lib/utils';
import { AccountModel } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { CheckIcon, CircleSlashIcon, InfoIcon, PlusIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import CreateAccountGroupDialog from './create-account-group-dialog.vue';

const MAX_PREVIEW_CURRENCIES = 3;

const { t } = useI18n();

const props = defineProps<{
  account: AccountModel;
}>();
const isOpen = ref(false);

const selectedGroup = ref<AccountGroups | null>(null);

const { data } = useQuery({
  queryFn: () => loadAccountGroups(),
  queryKey: VUE_QUERY_CACHE_KEYS.accountGroups,
  staleTime: Infinity,
});

const accountId = ref(props.account.id);

const { data: currentSelection } = useAccountGroupForAccount(accountId, {
  enabled: () => isOpen.value,
});

watch(
  () => props.account.id,
  (newAccountId) => {
    accountId.value = newAccountId;
  },
  { immediate: true },
);

watch(
  currentSelection,
  (v) => {
    selectedGroup.value = v ?? null;
  },
  { immediate: true },
);

const hasBankGroups = computed(() => (data.value ?? []).some((group) => group.bankDataProviderConnectionId != null));

const groupMeta = (group: AccountGroups): string => {
  const parts = [t('dialogs.linkAccountGroup.accountsCount', { count: group.accounts.length })];
  const currencies = [...new Set(group.accounts.map((account) => account.currencyCode))];
  if (currencies.length) {
    const visible = currencies.slice(0, MAX_PREVIEW_CURRENCIES).join(', ');
    const overflow = currencies.length - MAX_PREVIEW_CURRENCIES;
    parts.push(overflow > 0 ? `${visible} +${overflow}` : visible);
  }
  return parts.join(' · ');
};

const closeDialog = () => {
  isOpen.value = false;
};

const { isPending: isLinkingAccount, mutate: linkAccount } = useLinkAccountToGroup({ onSuccess: closeDialog });
const { isPending: isUnlinkingAccount, mutate: unlinkAccount } = useUnlinkAccountFromGroup({ onSuccess: closeDialog });

const isFormPending = computed(() => isLinkingAccount.value || isUnlinkingAccount.value);

const saveChanges = () => {
  if (selectedGroup.value) {
    linkAccount({
      accountId: props.account.id,
      groupId: selectedGroup.value.id,
    });
  } else {
    unlinkAccount({
      accountId: props.account.id,
      groupId: currentSelection.value!.id,
    });
  }
};

const isGroupChanged = computed(() => (currentSelection.value?.id ?? null) !== (selectedGroup.value?.id ?? null));

const rowClass = (isSelected: boolean) =>
  cn('h-auto w-full justify-start gap-3 px-3 py-2.5', isSelected && 'bg-primary/10 hover:bg-primary/15');
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #trigger>
      <slot />
    </template>
    <template #title>{{ t('dialogs.linkAccountGroup.title') }}</template>

    <div class="grid gap-0.5">
      <UiButton
        variant="ghost"
        :class="rowClass(selectedGroup === null)"
        :disabled="isFormPending"
        @click="selectedGroup = null"
      >
        <span
          class="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed"
        >
          <CircleSlashIcon class="size-4" />
        </span>
        <span class="min-w-0 flex-1 text-left">
          <span class="block truncate text-sm font-medium">{{ t('dialogs.linkAccountGroup.noGroup') }}</span>
          <span class="text-muted-foreground block text-xs font-normal">
            {{ t('dialogs.linkAccountGroup.noGroupDescription') }}
          </span>
        </span>
        <CheckIcon v-if="selectedGroup === null" class="text-primary-text size-5 shrink-0" />
      </UiButton>

      <UiButton
        v-for="group of data ?? []"
        :key="group.id"
        variant="ghost"
        :class="rowClass(group.id === selectedGroup?.id)"
        :disabled="isFormPending"
        @click="selectedGroup = group"
      >
        <GroupLogo :group="group" size="size-7" variant="tile" />
        <span class="min-w-0 flex-1 text-left">
          <span class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ group.name }}</span>
            <span
              v-if="group.id === currentSelection?.id"
              class="bg-success/20 text-success-text shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase"
            >
              {{ t('dialogs.linkAccountGroup.current') }}
            </span>
          </span>
          <span class="text-muted-foreground block text-xs font-normal">{{ groupMeta(group) }}</span>
        </span>
        <CheckIcon v-if="group.id === selectedGroup?.id" class="text-primary-text size-5 shrink-0" />
      </UiButton>
    </div>

    <div v-if="hasBankGroups" class="bg-muted text-muted-foreground mt-3 flex items-start gap-2 rounded-lg p-3 text-xs">
      <InfoIcon class="text-primary-text mt-0.5 size-4 shrink-0" />
      <span>{{ t('dialogs.linkAccountGroup.syncHint') }}</span>
    </div>

    <div class="mt-6">
      <template v-if="isGroupChanged">
        <div class="grid grid-cols-2 gap-2">
          <UiButton
            variant="secondary"
            :disabled="isFormPending"
            @click="selectedGroup = (currentSelection as AccountGroups | null) ?? null"
          >
            {{ t('common.actions.cancel') }}
          </UiButton>
          <UiButton :disabled="isFormPending" @click="saveChanges">{{ t('common.actions.save') }}</UiButton>
        </div>
      </template>
      <template v-else>
        <CreateAccountGroupDialog>
          <UiButton variant="secondary" class="w-full">
            <PlusIcon class="size-4" />
            {{ t('dialogs.linkAccountGroup.createNewGroup') }}
          </UiButton>
        </CreateAccountGroupDialog>
      </template>
    </div>
  </ResponsiveDialog>
</template>
